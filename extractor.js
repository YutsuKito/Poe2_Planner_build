const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ============================================================================
// Database & Path Resolution
// ============================================================================
const SCRIPT_DIR = __dirname;
const PASSIVES_PATH = path.join(SCRIPT_DIR, "passives_default.json");
const TREE_PATH = path.join(SCRIPT_DIR, "tree.json");

function loadJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (err) {
    console.error(`[Aviso] Falha ao carregar banco de dados em ${filePath}:`, err.message);
  }
  return null;
}

// ============================================================================
// Text Cleaners & Formatters
// ============================================================================
function cleanAsciiText(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^\x00-\x7F]/g, "");   // remove caracteres nao-ASCII
}

function createBuildPlannerFilename(buildName) {
  const safeName = buildName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${safeName}.build`;
}

function getOfficialAscendancy(className, ascendancy) {
  const cleanClass = className ? className.trim().toLowerCase() : "";
  const cleanAsc = ascendancy ? ascendancy.trim().toLowerCase() : "";

  const poe2Ascendancies = {
    deadeye: "Deadeye",
    pathfinder: "Pathfinder",
    lich: "Lich",
    infernalist: "Infernalist",
    bloodmage: "Bloodmage",
    stormweaver: "Stormweaver",
    titan: "Titan",
    warbringer: "Warbringer"
  };

  if (poe2Ascendancies[cleanAsc]) {
    return poe2Ascendancies[cleanAsc];
  }

  const baseMap = {
    witch: "Witch1",
    ranger: "Ranger1",
    sorceress: "Sorceress1",
    warrior: "Warrior1",
    monk: "Monk1",
    mercenary: "Mercenary1",
    druid: "Druid1",
    huntress: "Huntress1",
    templar: "Templar1",
    shadow: "Shadow1",
    marauder: "Marauder1",
    duelist: "Duelist1",
    scion: "Scion1"
  };

  return baseMap[cleanClass] || "Witch1";
}

function toMetadataGemId(name, isSupport) {
  if (!name) return "";
  if (name.startsWith("Metadata/")) return name;

  let cleanName = name
    .split(/[^a-zA-Z0-9]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");

  cleanName = cleanName.replace(/(I|Ii|Iii|Iv|V|Vi|Vii|Viii|Ix|X)$/i, "");

  if (isSupport) {
    cleanName = cleanName.replace(/Support(Gem)?$/i, "");
    return `Metadata/Items/Gems/SupportGem${cleanName}`;
  } else {
    return `Metadata/Items/Gems/SkillGem${cleanName}`;
  }
}

// ============================================================================
// XML Parser (Zero Dependencies)
// ============================================================================
function parseXmlMinimal(xmlText) {
  const cleaned = xmlText.replace(/<\?xml[^?]*\?>\s*/g, "").trim();
  if (cleaned.length === 0) return undefined;
  const nodes = parseNodes(cleaned, 0);
  return nodes.length > 0 ? nodes[0] : undefined;
}

function parseNodes(text, depth) {
  if (depth > 20) return [];
  const nodes = [];
  let pos = 0;

  while (pos < text.length) {
    const tagStart = text.indexOf("<", pos);
    if (tagStart === -1) break;

    if (text.startsWith("<!--", tagStart)) {
      const commentEnd = text.indexOf("-->", tagStart);
      pos = commentEnd === -1 ? text.length : commentEnd + 3;
      continue;
    }

    if (text[tagStart + 1] === "/") break;

    const tagEnd = text.indexOf(">", tagStart);
    if (tagEnd === -1) break;

    const tagContent = text.substring(tagStart + 1, tagEnd);
    const isSelfClosing = tagContent.endsWith("/");
    const cleanTagContent = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent.trim();

    const spaceIdx = cleanTagContent.indexOf(" ");
    const tagName = spaceIdx === -1 ? cleanTagContent : cleanTagContent.substring(0, spaceIdx);
    const attrString = spaceIdx === -1 ? "" : cleanTagContent.substring(spaceIdx);

    const attrs = parseAttributes(attrString);

    if (isSelfClosing) {
      nodes.push({ tag: tagName, attrs, children: [], text: "" });
      pos = tagEnd + 1;
    } else {
      const closingTag = `</${tagName}>`;
      const closingIdx = findClosingTag(text, tagName, tagEnd + 1);
      if (closingIdx === -1) {
        nodes.push({ tag: tagName, attrs, children: [], text: "" });
        pos = tagEnd + 1;
      } else {
        const innerText = text.substring(tagEnd + 1, closingIdx);
        const children = innerText.includes("<") ? parseNodes(innerText, depth + 1) : [];
        const nodeText = children.length === 0 ? innerText.trim() : "";

        nodes.push({ tag: tagName, attrs, children, text: nodeText });
        pos = closingIdx + closingTag.length;
      }
    }
  }

  return nodes;
}

function findClosingTag(text, tagName, startPos) {
  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}>`;
  let depth = 1;
  let pos = startPos;

  while (pos < text.length && depth > 0) {
    const nextOpen = text.indexOf(openTag, pos);
    const nextClose = text.indexOf(closeTag, pos);

    if (nextClose === -1) return -1;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      const charAfterTag = text[nextOpen + openTag.length];
      if (charAfterTag === " " || charAfterTag === ">" || charAfterTag === "/") {
        depth++;
      }
      pos = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      pos = nextClose + closeTag.length;
    }
  }
  return -1;
}

function parseAttributes(attrString) {
  const attrs = {};
  const regex = /(\w[\w\-]*)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function findChild(node, tagName) {
  return node.children.find((child) => child.tag === tagName);
}

function findChildren(node, tagName) {
  return node.children.filter((child) => child.tag === tagName);
}

// ============================================================================
// PoB XML Extractor
// ============================================================================
function extractPlayerStats(buildNode) {
  const stats = {};
  const statMapping = {
    Life: "life",
    EnergyShield: "energyShield",
    Armour: "armour",
    Evasion: "evasion",
    FireResist: "fireRes",
    ColdResist: "coldRes",
    LightningResist: "lightningRes",
    ChaosResist: "chaosRes"
  };

  const statNodes = findChildren(buildNode, "PlayerStat");
  for (const node of statNodes) {
    const statName = node.attrs["stat"];
    const value = node.attrs["value"];
    if (statName && value !== undefined) {
      const key = statMapping[statName];
      if (key) stats[key] = parseFloat(value);
    }
  }
  return stats;
}

function extractSkills(skillsNode, warnings) {
  if (!skillsNode) return { mainSkill: "Unknown", secondarySkills: [], skillSetups: [] };
  const skillSetups = [];
  const allSkillNames = [];

  const skillSets = findChildren(skillsNode, "SkillSet");
  const skillNodes = skillSets.length > 0
    ? skillSets.flatMap((ss) => findChildren(ss, "Skill"))
    : findChildren(skillsNode, "Skill");

  for (const skillNode of skillNodes) {
    const enabled = skillNode.attrs["enabled"] !== "false";
    if (!enabled) continue;

    const gems = findChildren(skillNode, "Gem");
    const enabledGems = gems.filter((g) => g.attrs["enabled"] !== "false");
    if (enabledGems.length === 0) continue;

    const mainGem = enabledGems[0];
    const mainSkillName = mainGem.attrs["nameSpec"] || mainGem.attrs["gemId"] || "Unknown Gem";
    const supports = enabledGems.slice(1).map((g) => g.attrs["nameSpec"] || g.attrs["gemId"] || "Unknown Support");

    allSkillNames.push(mainSkillName);
    skillSetups.push({
      mainSkill: mainSkillName,
      supports,
      slot: skillNode.attrs["slot"]
    });
  }

  const mainSkill = allSkillNames[0] ?? "Unknown";
  const secondarySkills = allSkillNames.slice(1);

  return { mainSkill, secondarySkills, skillSetups };
}

function extractItems(itemsNode, warnings) {
  if (!itemsNode) return [];
  const slotAssignments = new Map();
  const slotNodes = findChildren(itemsNode, "Slot");

  for (const slotNode of slotNodes) {
    const name = slotNode.attrs["name"];
    const itemId = slotNode.attrs["itemId"];
    if (name && itemId && itemId !== "0") {
      slotAssignments.set(itemId, name);
    }
  }

  const itemNodes = findChildren(itemsNode, "Item");
  const items = [];

  for (const itemNode of itemNodes) {
    const itemId = itemNode.attrs["id"];
    if (!itemId) continue;

    const slotName = slotAssignments.get(itemId);
    if (!slotName) continue;

    const parsed = parseItemText(itemNode.text, slotName);
    if (parsed) items.push(parsed);
  }

  return items;
}

function parseItemText(text, slotName) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  let rarity = "rare";
  let name = "Unknown Item";
  let baseName = "Unknown Base";
  let itemLevel;
  let sockets;
  const mods = [];

  let lineIdx = 0;
  let implicits = 0;
  let pastImplicits = false;

  for (const line of lines) {
    if (line.startsWith("Rarity:")) {
      rarity = line.replace("Rarity:", "").trim().toLowerCase();
      lineIdx++;
      continue;
    }
    if (line.startsWith("Item Level:")) {
      itemLevel = parseInt(line.replace("Item Level:", "").trim(), 10) || undefined;
      lineIdx++;
      continue;
    }
    if (line.startsWith("Sockets:")) {
      sockets = parseInt(line.replace("Sockets:", "").trim(), 10) || undefined;
      lineIdx++;
      continue;
    }
    if (line.startsWith("Implicits:")) {
      implicits = parseInt(line.replace("Implicits:", "").trim(), 10) || 0;
      pastImplicits = false;
      lineIdx++;
      continue;
    }
    if (lineIdx === 1) {
      name = line;
      lineIdx++;
      continue;
    }
    if (lineIdx === 2) {
      baseName = line;
      lineIdx++;
      continue;
    }

    if (lineIdx >= 3 && !line.startsWith("Rarity:") && !line.startsWith("Item Level:") && !line.startsWith("Sockets:") && !line.startsWith("Implicits:")) {
      if (!pastImplicits && implicits > 0) {
        mods.push(parseModLine(line, "implicit"));
        implicits--;
        if (implicits === 0) pastImplicits = true;
      } else {
        mods.push(parseModLine(line, "unknown"));
      }
    }
    lineIdx++;
  }

  return { slot: slotName, name, baseName, rarity, itemLevel, mods, sockets };
}

function parseModLine(line, defaultType) {
  const numMatch = line.match(/([+-]?\d+(?:\.\d+)?)/);
  const value = numMatch ? parseFloat(numMatch[1]) : undefined;
  let type = defaultType;
  let text = line;

  if (line.startsWith("{crafted}")) {
    type = "crafted";
    text = line.replace("{crafted}", "").trim();
  } else if (line.startsWith("{enchant}")) {
    type = "enchant";
    text = line.replace("{enchant}", "").trim();
  }
  return { text, type, value };
}

function extractPassiveTree(treeNode, warnings) {
  if (!treeNode) return undefined;
  const specs = findChildren(treeNode, "Spec");
  if (specs.length === 0) return undefined;

  const activeSpecId = treeNode.attrs["activeSpec"];
  let spec = specs[0];

  if (activeSpecId) {
    const foundSpec = specs.find((s) => s.attrs["id"] === activeSpecId);
    if (foundSpec) {
      spec = foundSpec;
    } else {
      const idx = parseInt(activeSpecId, 10) - 1;
      if (idx >= 0 && idx < specs.length) {
        spec = specs[idx];
      }
    }
  }

  const nodesStr = spec.attrs["nodes"] ?? "";
  const nodeIds = nodesStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0);

  return {
    totalPoints: nodeIds.length,
    nodeIds
  };
}

// ============================================================================
// Passives Translator
// ============================================================================
function mapNodeToOfficialId(nodeId, node, passivesData) {
  if (passivesData && passivesData[nodeId] && passivesData[nodeId].id) {
    return passivesData[nodeId].id;
  }
  if (!node) return nodeId;

  if (node.ascendancyName) {
    const typeFrame = node.isNotable ? "Notable" : "Small";
    const ascMap = {
      titan: "Warrior1",
      warbringer: "Warrior2",
      smithofkitava: "Warrior3",
      deadeye: "Ranger1",
      pathfinder: "Ranger3",
      infernalist: "Witch1",
      bloodmage: "Witch2",
      lich: "Witch3",
      abyssallich: "Witch3b",
      stormweaver: "Sorceress1",
      chronomancer: "Sorceress2",
      discipleofvarashta: "Sorceress3",
      invoker: "Monk2",
      acolyteofchayula: "Monk3",
      amazon: "Huntress1",
      ritualist: "Huntress3",
      tactician: "Mercenary1",
      witchhunter: "Mercenary2",
      gemlinglegionnaire: "Mercenary3",
      oracle: "Druid1",
      shaman: "Druid2"
    };

    const cleanAscName = node.ascendancyName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const ascKey = ascMap[cleanAscName] || node.ascendancyName;
    return `Ascendancy${ascKey}${typeFrame}${node.skill}`;
  }

  if (node.isJewelSocket) {
    return `jewel_slot${node.skill}`;
  }

  const statsText = (node.stats || []).join(" ").toLowerCase();
  const iconPath = (node.icon || "").toLowerCase();
  let prefix = "";

  if (statsText.includes("to strength") || statsText.includes("strength and")) {
    prefix = "strength";
  } else if (statsText.includes("to dexterity") || statsText.includes("dexterity and")) {
    prefix = "dexterity";
  } else if (statsText.includes("to intelligence") || statsText.includes("intelligence and")) {
    prefix = "intelligence";
  } else if (statsText.includes("attributes") || statsText.includes("all basic attributes")) {
    prefix = "attributes";
  } else if (statsText.includes("melee")) {
    prefix = "melee";
  } else if (statsText.includes("fire damage") || statsText.includes("ignite") || statsText.includes("fire resistance")) {
    prefix = "fire";
  } else if (statsText.includes("cold damage") || statsText.includes("freeze") || statsText.includes("cold resistance")) {
    prefix = "cold";
  } else if (statsText.includes("lightning damage") || statsText.includes("shock") || statsText.includes("lightning resistance")) {
    prefix = "lightning";
  } else if (statsText.includes("chaos damage") || statsText.includes("wither") || statsText.includes("chaos resistance")) {
    prefix = "chaos";
  } else if (statsText.includes("poison")) {
    prefix = "poison";
  } else if (statsText.includes("warcry") || statsText.includes("warcries")) {
    prefix = "warcries";
  } else if (statsText.includes("slam") || statsText.includes("slams")) {
    prefix = "slams";
  } else if (statsText.includes("area of effect") || statsText.includes("area attacks")) {
    prefix = "area_attacks";
  } else if (statsText.includes("duration of spells") || statsText.includes("spell duration") || statsText.includes("duration of spell")) {
    prefix = "duration_spells";
  } else if (statsText.includes("bow") || statsText.includes("arrow")) {
    prefix = "bows";
  } else if (statsText.includes("shield")) {
    prefix = "shields";
  } else if (statsText.includes("minion") || statsText.includes("minions")) {
    prefix = "minions";
  } else if (statsText.includes("life") || statsText.includes("health")) {
    prefix = "life";
  } else if (statsText.includes("mana")) {
    prefix = "mana";
  } else if (statsText.includes("energy shield")) {
    prefix = "energy_shield";
  } else if (statsText.includes("evasion")) {
    prefix = "evasion";
  } else if (statsText.includes("armour")) {
    prefix = "armour";
  } else {
    const matchIcon = iconPath.match(/\/passives\/(?:[^\/]+\/)?([a-z_]+)/);
    if (matchIcon && matchIcon[1]) {
      prefix = matchIcon[1].replace(/node$/, "").replace(/_$/, "");
    }
  }

  if (node.isNotable) {
    const cleanName = node.name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/(^_|_$)/g, "");
    return `${cleanName}_notable${node.skill}`;
  }

  if (node.isKeystone) {
    const cleanName = node.name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/(^_|_$)/g, "");
    return `${cleanName}_keystone${node.skill}`;
  }

  if (!prefix) prefix = "node";
  return `${prefix}${node.skill}`;
}

// ============================================================================
// Official build planner assembler
// ============================================================================
function createBuildPlannerExport(snapshot, treeData, passivesData) {
  const passives = [];
  if (snapshot.passiveTree && snapshot.passiveTree.nodeIds) {
    const mapped = snapshot.passiveTree.nodeIds.map((id) => {
      const numId = id.toString();
      if (treeData && treeData.nodes && treeData.nodes[numId]) {
        const node = treeData.nodes[numId];
        return mapNodeToOfficialId(numId, node, passivesData);
      }
      return id;
    });
    // Filter numeric IDs that failed mapping
    passives.push(...mapped.filter((id) => !/^\d+$/.test(id)));
  }

  const skills = [];
  if (snapshot.skillSetups && snapshot.skillSetups.length > 0) {
    for (const setup of snapshot.skillSetups) {
      skills.push({
        id: toMetadataGemId(setup.mainSkill, false),
        additional_text: cleanAsciiText(`Setup de Habilidade: ${setup.mainSkill}\nSlot: ${setup.slot || "desconhecido"}\nSuportes: ${setup.supports.join(", ") || "nenhum"}`),
        support_skills: setup.supports.map((s) => ({ id: toMetadataGemId(s, true) }))
      });
    }
  }

  const items = [];
  const slotMapping = {
    "Weapon 1": "Weapon1",
    "Weapon 2": "Weapon2",
    "Helmet": "Helm1",
    "Body Armour": "BodyArmour1",
    "Gloves": "Gloves1",
    "Boots": "Boots1",
    "Amulet": "Amulet1",
    "Ring 1": "Ring1",
    "Ring 2": "Ring2",
    "Belt": "Belt1",
    "Flask 1": "Flask1",
    "Flask 2": "Flask2",
    "Flask 3": "Flask3"
  };

  if (snapshot.equippedItems && snapshot.equippedItems.length > 0) {
    for (const eqItem of snapshot.equippedItems) {
      const requiredMods = eqItem.mods.map((m) => `<green>{${m.text}${m.value !== undefined ? ` (${m.value})` : ""}}`);
      const notes = [
        `Item importado: ${eqItem.name}`,
        `Raridade: ${eqItem.rarity}`,
        `Item Level: ${eqItem.itemLevel || "desconhecido"}`,
        `Mods:\n${requiredMods.join("\n")}`
      ];

      items.push({
        inventory_id: slotMapping[eqItem.slot] || "Weapon1",
        slot_x: 0,
        slot_y: 0,
        level_interval: [0, 100],
        unique_name: cleanAsciiText(eqItem.baseName),
        additional_text: cleanAsciiText(notes.join("\n\n"))
      });
    }
  }

  const buildName = `Imported ${snapshot.className} Build`;
  const descParts = [
    `Build: ${buildName}`,
    `Classe: ${snapshot.className} | Ascendencia: ${snapshot.ascendancy || "Nenhuma"} | Level: ${snapshot.level}`,
    `Fonte de Importacao: pob_xml`
  ];

  const officialBuild = {
    name: cleanAsciiText(buildName),
    description: cleanAsciiText(descParts.join("\n")),
    ascendancy: getOfficialAscendancy(snapshot.className, snapshot.ascendancy),
    passives: passives.length > 0 ? passives : undefined,
    skills: skills.length > 0 ? skills : undefined,
    inventory_slots: items.length > 0 ? items : undefined
  };

  return officialBuild;
}

// ============================================================================
// CLI Interface
// ============================================================================
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Uso: node extractor.js <caminho_do_xml_do_pob.xml>");
    process.exit(1);
  }

  const xmlPath = path.resolve(args[0]);
  if (!fs.existsSync(xmlPath)) {
    console.error(`Erro: O arquivo ${xmlPath} não foi encontrado.`);
    process.exit(1);
  }

  console.log(`Lendo arquivo XML em: ${xmlPath}...`);
  let xmlText = fs.readFileSync(xmlPath, "utf-8");

  // Se o arquivo contiver código de compartilhamento bruto (eN...) em vez de XML
  if (xmlText.trim().startsWith("eN") || (!xmlText.includes("<PathOfBuilding") && !xmlText.includes("<PathOfBuilding2"))) {
    console.log("O arquivo parece conter um código de compartilhamento do PoB. Decodificando...");
    try {
      const buffer = Buffer.from(xmlText.trim().replace(/\s+/g, ""), "base64");
      xmlText = zlib.inflateSync(buffer).toString("utf-8");
      console.log("Decodificado com sucesso!");
    } catch (err) {
      console.error("Falha ao decodificar código de compartilhamento:", err.message);
      process.exit(1);
    }
  }

  console.log("Carregando tabelas de mapeamento de passivas...");
  const treeData = loadJsonFile(TREE_PATH);
  const passivesData = loadJsonFile(PASSIVES_PATH);

  if (!treeData || !passivesData) {
    console.log("[Alerta] 'tree.json' ou 'passives_default.json' não encontrados na mesma pasta.");
    console.log("Os nós da árvore de passivas numéricos NÃO serão mapeados e serão omitidos no .build final.");
  }

  console.log("Analisando estrutura do XML...");
  const root = parseXmlMinimal(xmlText);
  if (!root) {
    console.error("Erro: XML inválido ou mal-formatado.");
    process.exit(1);
  }

  const buildNode = findChild(root, "Build");
  if (!buildNode) {
    console.error("Erro: Tag <Build> não encontrada no XML.");
    process.exit(1);
  }

  const className = buildNode.attrs["className"] ?? "Witch";
  const ascendancy = buildNode.attrs["ascendClassName"] ?? "None";
  const levelStr = buildNode.attrs["level"] ?? "90";
  const level = parseInt(levelStr, 10) || 90;

  const playerStats = extractPlayerStats(buildNode);
  const skillsNode = findChild(root, "Skills");
  const { skillSetups } = extractSkills(skillsNode, []);

  const itemsNode = findChild(root, "Items");
  const equippedItems = extractItems(itemsNode, []);

  const treeNode = findChild(root, "Tree");
  const passiveTree = extractPassiveTree(treeNode, []);

  const snapshot = {
    className,
    ascendancy,
    level,
    equippedItems,
    skillSetups,
    passiveTree,
    ...playerStats
  };

  console.log(`Construindo arquivo oficial do Build Planner para ${className} (${ascendancy || "Sem Ascendência"})...`);
  const officialBuild = createBuildPlannerExport(snapshot, treeData, passivesData);

  const outFilename = createBuildPlannerFilename(`Imported ${className} Build`);
  const outPath = path.join(path.dirname(xmlPath), outFilename);

  fs.writeFileSync(outPath, JSON.stringify(officialBuild, null, 2), "utf-8");
  console.log(`\nPronto! O arquivo do Build Planner foi gerado em:\n  -> ${outPath}\n`);
  console.log(`Nós de passivas alocados e salvos: ${officialBuild.passives ? officialBuild.passives.length : 0}`);
}

main();

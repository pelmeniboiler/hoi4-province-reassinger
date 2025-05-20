import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  // Command 1: Reassign Provinces
  let reassignDisposable = vscode.commands.registerCommand('hoi4.reassignProvinces', async () => {
    try {
      const provinceIds = await promptForProvinceIds();
      if (!provinceIds) return;

      const stateId = await promptForStateId('Enter the target state ID (e.g., "106")');
      if (!stateId) return;

      const statesDirPath = getStatesDirPath();
      if (!statesDirPath) return;

      await reassignProvinces(statesDirPath, provinceIds, stateId);

      vscode.window.showInformationMessage(
        `Successfully reassigned provinces ${provinceIds.join(', ')} to state ${stateId}.`
      );
    } catch (error) {
      handleError(error, 'Error reassigning provinces');
    }
  });

  // Command 2: Create State
  let createStateDisposable = vscode.commands.registerCommand('hoi4.createState', async () => {
    try {
      // Prompt for province IDs
      const provinceIds = await promptForProvinceIds();
      if (!provinceIds) return;

      // Prompt for state category
      const stateCategories = [
        'enclave', 'tiny_island', 'pastoral', 'small_island', 'rural',
        'town', 'large_town', 'city', 'large_city', 'metropolis', 'megalopolis'
      ];
      const stateCategory = await vscode.window.showQuickPick(stateCategories, {
        placeHolder: 'Select the state category',
        canPickMany: false
      });
      if (!stateCategory) return;

      // Prompt for owner tag with autocomplete
      const statesDirPath = getStatesDirPath();
      if (!statesDirPath) return;
      const countryTags = await getCountryTags();
      const ownerTag = await vscode.window.showQuickPick(countryTags, {
        placeHolder: 'Select or type the owner country tag (e.g., ITA)',
        canPickMany: false
      });
      if (!ownerTag) return;

      // Prompt for core tags
      const coreTagsInput = await vscode.window.showInputBox({
        prompt: 'Enter space-separated country tags for cores (e.g., "ITA GER")',
        placeHolder: 'ITA GER',
        validateInput: (value) => {
          if (!value.trim()) return null;
          const tags = value.trim().split(/\s+/);
          for (const tag of tags) {
            if (!/^[A-Z0-9]{3}$/.test(tag)) {
              return `Invalid tag: "${tag}". Tags must be 3-character codes (e.g., ITA).`;
            }
            if (!countryTags.includes(tag)) {
              return `Unknown tag: "${tag}". Choose from known country tags.`;
            }
          }
          return null;
        }
      });
      const coreTags = coreTagsInput ? coreTagsInput.trim().split(/\s+/).map(tag => tag.trim()) : [];

      // Generate new state ID
      const newStateId = await getNextStateId(statesDirPath);
      if (!newStateId) {
        vscode.window.showErrorMessage('Could not determine the next state ID.');
        return;
      }

      // Create the new state file
      const stateContent = generateStateContent(newStateId, stateCategory, ownerTag, coreTags, provinceIds);
      const newFileName = `${newStateId}-NewState.txt`;
      const newFilePath = path.join(statesDirPath, newFileName);
      fs.writeFileSync(newFilePath, stateContent, 'utf8');

      // Reassign provinces to the new state
      await reassignProvinces(statesDirPath, provinceIds, newStateId.toString());

      vscode.window.showInformationMessage(
        `Created state ${newStateId} with provinces ${provinceIds.join(', ')} in "${newFileName}".`
      );
    } catch (error) {
      handleError(error, 'Error creating state');
    }
  });

  context.subscriptions.push(reassignDisposable, createStateDisposable);
}

// Helper: Prompt for province IDs
async function promptForProvinceIds(): Promise<string[] | undefined> {
  const provinceInput = await vscode.window.showInputBox({
    prompt: 'Enter province IDs (space-separated, e.g., "1234 5678")',
    placeHolder: '1234 5678',
    validateInput: (value) => {
      if (!value.trim()) return 'Please enter at least one province ID.';
      const ids = value.trim().split(/\s+/);
      for (const id of ids) {
        if (!/^\d+$/.test(id)) {
          return `Invalid province ID: "${id}". IDs must be positive integers.`;
        }
      }
      return null;
    }
  });
  return provinceInput ? provinceInput.trim().split(/\s+/).map(id => id.trim()) : undefined;
}

// Helper: Prompt for state ID
async function promptForStateId(prompt: string): Promise<string | undefined> {
  return await vscode.window.showInputBox({
    prompt,
    placeHolder: '106',
    validateInput: (value) => {
      if (!value.trim()) return 'Please enter a state ID.';
      if (!/^\d+$/.test(value)) return 'State ID must be a positive integer.';
      return null;
    }
  });
}

// Helper: Get states directory path
function getStatesDirPath(): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return undefined;
  }

  const config = vscode.workspace.getConfiguration('hoi4ProvinceReassigner');
  const defaultStatesDir = 'history/states';
  const statesDir = config.get<string>('statesDirectory', defaultStatesDir);
  const statesDirPath = path.join(workspaceFolders[0].uri.fsPath, statesDir);

  if (!fs.existsSync(statesDirPath) || !fs.statSync(statesDirPath).isDirectory()) {
    vscode.window.showErrorMessage(`States directory "${statesDir}" does not exist or is not a directory.`);
    return undefined;
  }

  return statesDirPath;
}

// Helper: Read country tags from common/country_tags
async function getCountryTags(): Promise<string[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return [];

  const tagsDir = path.join(workspaceFolders[0].uri.fsPath, 'common/country_tags');
  if (!fs.existsSync(tagsDir) || !fs.statSync(tagsDir).isDirectory()) {
    vscode.window.showWarningMessage(`Country tags directory "${tagsDir}" not found. Autocomplete limited.`);
    return [];
  }

  const tagFiles = fs.readdirSync(tagsDir).filter(file => file.endsWith('.txt'));
  const tags: string[] = [];

  for (const file of tagFiles) {
    try {
      const content = fs.readFileSync(path.join(tagsDir, file), 'utf8');
      const tagMatches = content.matchAll(/^\s*([A-Z0-9]{3})\s*=/gm);
      for (const match of tagMatches) {
        if (match[1]) tags.push(match[1]);
      }
    } catch (error) {
      console.warn(`Skipping country tags file "${file}" due to read error:`, error);
    }
  }

  return tags.sort();
}

// Helper: Get next state ID
async function getNextStateId(statesDir: string): Promise<number | undefined> {
  const files = fs.readdirSync(statesDir).filter(file => file.endsWith('.txt'));
  let maxId = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(statesDir, file), 'utf8');
      const idMatch = content.match(/state={\s*id\s*=\s*(\d+)/);
      if (idMatch && idMatch[1]) {
        const id = parseInt(idMatch[1], 10);
        if (id > maxId) maxId = id;
      }
    } catch (error) {
      console.warn(`Skipping file "${file}" due to read error:`, error);
    }
  }

  return maxId + 1;
}

// Helper: Generate state file content
function generateStateContent(
  id: number,
  stateCategory: string,
  ownerTag: string,
  coreTags: string[],
  provinceIds: string[]
): string {
  const coreEntries = coreTags.length > 0
    ? coreTags.map(tag => `\t\tadd_core_of = ${tag}`).join('\n')
    : '';

  return `state={
\tid = ${id}
\tname = "STATE_${id}"
\tmanpower = 1
\tstate_category = ${stateCategory}
\thistory={
\t\towner = ${ownerTag}
${coreEntries}
\t}
\tprovinces={
\t\t${provinceIds.join(' ')}
\t}
}`;
}

// Helper: Reassign provinces
async function reassignProvinces(statesDir: string, provinceIds: string[], targetStateId: string) {
  const files = fs.readdirSync(statesDir).filter(file => file.endsWith('.txt'));

  // Verify target state exists and has a provinces block
  let targetFilePath: string | null = null;
  let targetContent: string | null = null;
  for (const file of files) {
    const filePath = path.join(statesDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const stateIdMatch = content.match(/state={\s*id\s*=\s*(\d+)/);
      if (stateIdMatch && stateIdMatch[1] === targetStateId) {
        targetFilePath = filePath;
        targetContent = content;
        const provincesRegex = /provinces\s*=\s*{[^}]*}/;
        if (!provincesRegex.test(content)) {
          throw new Error(`Target state ${targetStateId} in file "${file}" is missing a provinces block.`);
        }
        break;
      }
    } catch (error) {
      console.warn(`Skipping file "${file}" due to read error:`, error);
    }
  }

  if (!targetFilePath || !targetContent) {
    throw new Error(`Could not find a state file for state ID ${targetStateId} in "${statesDir}".`);
  }

  // Process all state files
  for (const file of files) {
    const filePath = path.join(statesDir, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      console.warn(`Skipping file "${file}" due to read error:`, error);
      continue;
    }

    const stateIdMatch = content.match(/state={\s*id\s*=\s*(\d+)/);
    if (!stateIdMatch) {
      console.warn(`Skipping file "${file}": No valid state ID found.`);
      continue;
    }
    const currentStateId = stateIdMatch[1];

    const provincesRegex = /(provinces\s*=\s*{[^}]*})/;
    const provincesMatch = content.match(provincesRegex);
    if (!provincesMatch) {
      if (currentStateId === targetStateId) {
        throw new Error(`Target state ${targetStateId} in file "${file}" is missing a provinces block.`);
      }
      console.warn(`State ${currentStateId} in file "${file}" has no provinces block. Skipping.`);
      continue;
    }

    let provincesBlock = provincesMatch[1];
    let provinceList: string[] = (provincesBlock.match(/\d+/g) || []).map(String);

    provinceList = provinceList.filter(id => !provinceIds.includes(id));

    if (currentStateId === targetStateId) {
      provinceList.push(...provinceIds);
      provinceList.sort((a, b) => parseInt(a) - parseInt(b));
    }

    const newProvincesBlock = `provinces={\n\t${provinceList.join(' ')}\n}`;
    content = content.replace(provincesRegex, newProvincesBlock);

    try {
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (error) {
      throw new Error(`Failed to write file "${file}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Helper: Handle errors
function handleError(error: unknown, prefix: string) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  vscode.window.showErrorMessage(`${prefix}: ${errorMessage}`);
  console.error(`${prefix}:`, error);
}

export function deactivate() {}
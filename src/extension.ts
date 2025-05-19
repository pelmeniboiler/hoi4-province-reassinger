import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  // Register the command
  let disposable = vscode.commands.registerCommand('hoi4.reassignProvinces', async () => {
    try {
      // Step 1: Prompt for province IDs
      const provinceInput = await vscode.window.showInputBox({
        prompt: 'Enter province IDs (space-separated, e.g., "855 856 857")',
        placeHolder: '855 856 857',
        validateInput: (value) => {
          if (!value.trim()) {
            return 'Please enter at least one province ID.';
          }
          const ids = value.trim().split(/\s+/);
          for (const id of ids) {
            if (!/^\d+$/.test(id)) {
              return `Invalid province ID: "${id}". IDs must be positive integers.`;
            }
          }
          return null;
        },
      });

      if (!provinceInput) {
        return; // User cancelled
      }

      const provinceIds = provinceInput.trim().split(/\s+/).map(id => id.trim());

      // Step 2: Prompt for target state ID
      const stateId = await vscode.window.showInputBox({
        prompt: 'Enter the target state ID (e.g., "106")',
        placeHolder: '106',
        validateInput: (value) => {
          if (!value.trim()) {
            return 'Please enter a state ID.';
          }
          if (!/^\d+$/.test(value)) {
            return 'State ID must be a positive integer.';
          }
          return null;
        },
      });

      if (!stateId) {
        return; // User cancelled
      }

      // Step 3: Get the states directory
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      // Use configuration or default to 'history/states'
      const config = vscode.workspace.getConfiguration('hoi4ProvinceReassigner');
      const defaultStatesDir = 'history/states';
      const statesDir = config.get<string>('statesDirectory', defaultStatesDir);

      // Validate the directory
      const statesDirPath = path.join(workspaceFolders[0].uri.fsPath, statesDir);
      if (!fs.existsSync(statesDirPath) || !fs.statSync(statesDirPath).isDirectory()) {
        vscode.window.showErrorMessage(`States directory "${statesDir}" does not exist or is not a directory.`);
        return;
      }

      // Step 4: Process state files
      await reassignProvinces(statesDirPath, provinceIds, stateId);

      vscode.window.showInformationMessage(
        `Successfully reassigned provinces ${provinceIds.join(', ')} to state ${stateId}.`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Error reassigning provinces: ${errorMessage}`);
      console.error('ReassignProvinces Error:', error);
    }
  });

  context.subscriptions.push(disposable);
}

async function reassignProvinces(statesDir: string, provinceIds: string[], targetStateId: string) {
  const files = fs.readdirSync(statesDir).filter(file => file.endsWith('.txt'));

  // Step 1: Verify the target state exists and has a provinces block
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
          throw new Error(`Target state ${targetStateId} in file "${file}" is missing a provinces block. Please add one (e.g., provinces={}) and retry.`);
        }
        break;
      }
    } catch (error) {
      console.warn(`Skipping file "${file}" due to read error:`, error);
      continue;
    }
  }

  if (!targetFilePath || !targetContent) {
    throw new Error(`Could not find a state file for state ID ${targetStateId} in "${statesDir}".`);
  }

  // Step 2: Process all state files
  for (const file of files) {
    const filePath = path.join(statesDir, file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      console.warn(`Skipping file "${file}" due to read error:`, error);
      continue;
    }

    // Extract state ID
    const stateIdMatch = content.match(/state={\s*id\s*=\s*(\d+)/);
    if (!stateIdMatch) {
      console.warn(`Skipping file "${file}": No valid state ID found.`);
      continue;
    }
    const currentStateId = stateIdMatch[1];

    // Find provinces block
    const provincesRegex = /(provinces\s*=\s*{[^}]*})/;
    const provincesMatch = content.match(provincesRegex);
    if (!provincesMatch) {
      if (currentStateId === targetStateId) {
        // This should not happen due to earlier check, but handle for safety
        throw new Error(`Target state ${targetStateId} in file "${file}" is missing a provinces block.`);
      }
      console.warn(`State ${currentStateId} in file "${file}" has no provinces block. Skipping.`);
      continue;
    }

    let provincesBlock = provincesMatch[1];
    let provinceList: string[] = (provincesBlock.match(/\d+/g) || []).map(String);

    // Remove specified province IDs
    provinceList = provinceList.filter(id => !provinceIds.includes(id));

    if (currentStateId === targetStateId) {
      // Add province IDs to the target state
      provinceList.push(...provinceIds);
      // Sort numerically to maintain consistency
      provinceList.sort((a, b) => parseInt(a) - parseInt(b));
    }

    // Rebuild the provinces block
    const newProvincesBlock = `provinces={\n\t${provinceList.join(' ')}\n}`;
    content = content.replace(provincesRegex, newProvincesBlock);

    // Write the updated content back
    try {
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (error) {
      throw new Error(`Failed to write file "${file}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function deactivate() {}
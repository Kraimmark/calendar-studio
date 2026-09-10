import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { WorkspaceManager, WorkspaceStatus } from './WorkspaceManager';

function messageOf(error: unknown): string {
  const value = error as { message?: string };
  return value?.message ?? (error instanceof Error ? error.message : String(error));
}

export class TauriWorkspaceManager implements WorkspaceManager {
  async getStatus(): Promise<WorkspaceStatus> {
    try {
      return await invoke<WorkspaceStatus>('calendar_get_workspace_status', { payload: {} });
    } catch (error) {
      throw new Error(messageOf(error));
    }
  }

  async chooseAndSwitch(): Promise<WorkspaceStatus | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Выберите папку Calendar Studio',
    });
    if (selected === null || Array.isArray(selected)) return null;
    try {
      return await invoke<WorkspaceStatus>('calendar_switch_workspace', { payload: { directoryPath: selected } });
    } catch (error) {
      throw new Error(messageOf(error));
    }
  }
}

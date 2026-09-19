import { invoke } from '@tauri-apps/api/core';
import { open, save, type DialogFilter } from '@tauri-apps/plugin-dialog';

interface SaveFileOptions {
  defaultPath: string;
  filters: DialogFilter[];
}

export interface OpenedTextFile {
  path: string;
  contents: string;
}

export async function chooseTextFile(filters: DialogFilter[]): Promise<OpenedTextFile | null> {
  const path = await open({ multiple: false, directory: false, filters });
  if (!path) return null;
  const contents = await invoke<string>('calendar_read_text_file', { path });
  return { path, contents };
}

export async function saveTextFile(contents: string, options: SaveFileOptions): Promise<string | null> {
  const path = await save(options);
  if (!path) return null;
  await invoke('calendar_write_text_file', { path, contents });
  return path;
}

export async function saveBinaryFile(contents: Blob, options: SaveFileOptions): Promise<string | null> {
  const path = await save(options);
  if (!path) return null;
  const bytes = Array.from(new Uint8Array(await contents.arrayBuffer()));
  await invoke('calendar_write_binary_file', { path, contents: bytes });
  return path;
}

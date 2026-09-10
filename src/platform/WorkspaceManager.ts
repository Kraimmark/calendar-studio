export interface WorkspaceStatus {
  directoryPath: string;
  databasePath: string;
  isBootstrap: boolean;
  warning: string | null;
}

export interface WorkspaceManager {
  getStatus(): Promise<WorkspaceStatus>;
  chooseAndSwitch(): Promise<WorkspaceStatus | null>;
}

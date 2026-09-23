declare module 'react' {
  export type CSSProperties = Record<string, string | number | undefined>;
  export interface ChangeEvent<T = any> { target: T }
  export interface MouseEvent<T = any> { target: EventTarget | null; currentTarget: T; button: number; clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }
  export interface DragEvent<T = any> extends MouseEvent<T> { dataTransfer: DataTransfer }
  export interface KeyboardEvent<T = any> { key: string; preventDefault(): void; currentTarget: T }
  export const StrictMode: any;
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
}
declare module 'react-dom/client' {
  export function createRoot(element: Element | DocumentFragment): { render(node: any): void };
}
declare module 'react/jsx-runtime' {
  export const Fragment: any;
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
}
declare module '@tauri-apps/api/core' {
  export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}
declare namespace JSX {
  interface IntrinsicElements { [elementName: string]: any }
}

declare module '@tauri-apps/plugin-dialog' {
  export function open(options?: Record<string, unknown>): Promise<string | string[] | null>;
}

declare module '@fontsource-variable/inter/wght.css';

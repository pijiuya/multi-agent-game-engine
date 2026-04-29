import { fallbackWorld } from "./fallbackWorld";
import type { WorldMap, WorldSnapshot } from "../types";

export const apiBase = import.meta.env.VITE_API_BASE ?? "";

export async function getWorld(): Promise<WorldSnapshot> {
  try {
    const response = await fetch(`${apiBase}/api/world`);
    if (!response.ok) {
      throw new Error(`world request failed: ${response.status}`);
    }
    return response.json();
  } catch {
    return structuredClone(fallbackWorld);
  }
}

export async function saveMap(map: WorldMap): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(map)
    });
    if (!response.ok) {
      throw new Error(`map save failed: ${response.status}`);
    }
    return response.json();
  } catch {
    return null;
  }
}

export async function postAction(agentId: string, type: string, payload: Record<string, unknown>) {
  try {
    const response = await fetch(`${apiBase}/api/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, type, payload })
    });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

export async function setSimulation(running: boolean) {
  try {
    const response = await fetch(`${apiBase}/api/simulation/${running ? "start" : "pause"}`, {
      method: "POST"
    });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

export async function tickSimulation(): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/simulation/tick`, { method: "POST" });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

export async function createAgent(
  name: string,
  role: string,
  position: { x: number; y: number }
): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, position })
    });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

export async function uploadMapImage(file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${apiBase}/api/maps/image`, {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    throw new Error(`upload failed: ${response.status}`);
  }
  return response.json() as Promise<{ asset: string; url: string }>;
}

export function wsUrl() {
  if (apiBase.startsWith("http")) {
    return apiBase.replace(/^http/, "ws") + "/ws";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function assetUrl(path: string | null) {
  if (!path) {
    return null;
  }
  if (path.startsWith("blob:") || path.startsWith("http")) {
    return path;
  }
  return `${apiBase}${path}`;
}

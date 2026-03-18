/**
 * Docker API client for managing live service containers.
 *
 * Communicates with the Docker daemon via the Unix socket.
 * Only used when DOCKER_MODE=true.
 */

const DOCKER_SOCKET = "/var/run/docker.sock";

const DOCKER_NETWORK = process.env.DOCKER_NETWORK ?? "algotrader_default";
const LIVE_IMAGE = process.env.LIVE_IMAGE ?? "algotrader:latest";
const LIVE_PORT = parseInt(process.env.LIVE_PORT ?? "9400", 10);

export function isDockerMode(): boolean {
  return process.env.DOCKER_MODE === "true";
}

export function getLivePort(): number {
  return LIVE_PORT;
}

export function getContainerName(userId: string): string {
  // Use first 12 chars of userId to keep names reasonable
  return `algotrader-live-${userId.slice(0, 12)}`;
}

export function getContainerHostname(userId: string): string {
  return getContainerName(userId);
}

interface ContainerInfo {
  Id: string;
  State: { Status: string; Running: boolean };
}

// Node's built-in fetch doesn't support unix sockets directly.
// Use http module for Docker socket communication.
async function dockerFetch(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const http = await import("http");

  return new Promise((resolve, reject) => {
    const options = {
      socketPath: DOCKER_SOCKET,
      path,
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 500, data: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode ?? 500, data: {} });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Check if a live service container is running for a user.
 */
export async function isContainerRunning(userId: string): Promise<boolean> {
  const name = getContainerName(userId);
  const { status, data } = await dockerFetch("GET", `/containers/${name}/json`);
  if (status === 404) return false;
  return (data as ContainerInfo)?.State?.Running ?? false;
}

/**
 * Start a live service container for a user.
 * Creates and starts the container if it doesn't exist.
 */
export async function startContainer(userId: string, userEmail: string): Promise<boolean> {
  const name = getContainerName(userId);

  // Check if container already exists
  const { status: inspectStatus } = await dockerFetch("GET", `/containers/${name}/json`);

  if (inspectStatus === 200) {
    // Container exists — start it if stopped
    const { status: startStatus } = await dockerFetch("POST", `/containers/${name}/start`);
    return startStatus === 204 || startStatus === 304; // 304 = already running
  }

  // Create new container
  const { status: createStatus, data: createData } = await dockerFetch("POST", "/containers/create?name=" + name, {
    Image: LIVE_IMAGE,
    Cmd: ["npx", "tsx", "src/live/service.ts", `--user=${userEmail}`, `--port=${LIVE_PORT}`],
    Env: [`DOCKER_MODE=true`],
    ExposedPorts: { [`${LIVE_PORT}/tcp`]: {} },
    HostConfig: {
      Binds: [
        // Mount the same data volume as the web container
        // The web container's /app/data is the source of truth
        `${getDataVolume()}:/app/data`,
      ],
      AutoRemove: true,
      NetworkMode: DOCKER_NETWORK,
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [DOCKER_NETWORK]: {},
      },
    },
  });

  if (createStatus !== 201) {
    console.error("[Docker] Failed to create container:", createData);
    return false;
  }

  // Start the container
  const { status: startStatus } = await dockerFetch("POST", `/containers/${name}/start`);
  return startStatus === 204;
}

/**
 * Stop a live service container.
 */
export async function stopContainer(userId: string): Promise<boolean> {
  const name = getContainerName(userId);
  const { status } = await dockerFetch("POST", `/containers/${name}/stop?t=30`);
  return status === 204 || status === 304;
}

/**
 * Host-side path for the data volume, passed via DATA_VOLUME env var from docker-compose.
 */
function getDataVolume(): string {
  return process.env.DATA_VOLUME ?? "/app/data";
}

/**
 * List all running live service containers.
 */
export async function listLiveContainers(): Promise<Array<{ userId: string; name: string; id: string }>> {
  const { status, data } = await dockerFetch(
    "GET",
    '/containers/json?filters={"name":["algotrader-live-"]}',
  );

  if (status !== 200) return [];

  return (data as Array<{ Id: string; Names: string[] }>).map((c) => {
    const name = c.Names[0]?.replace(/^\//, "") ?? "";
    const userId = name.replace("algotrader-live-", "");
    return { userId, name, id: c.Id };
  });
}

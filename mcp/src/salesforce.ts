/**
 * Thin Salesforce REST client that authenticates through the Salesforce CLI.
 *
 * The server never stores credentials. It shells out to `sf org display --json`
 * to obtain the access token and instance URL for the org the user already
 * logged into with `sf org login web`. If a request comes back 401 the token is
 * refreshed once by re-running the CLI, which refreshes the session itself.
 *
 * Org selection, in order:
 *   1. JFORM_SF_ORG environment variable (alias or username)
 *   2. the CLI's default target org (`sf config set target-org ...`)
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
/** A stalled connection or an sf CLI waiting on a prompt must surface as an error, not a spinner. */
const REQUEST_TIMEOUT_MS = 30_000;
const CLI_TIMEOUT_MS = 20_000;

export interface OrgAuth {
  accessToken: string;
  instanceUrl: string;
  apiVersion: string;
  username: string;
  alias?: string;
}

export class SalesforceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode?: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "SalesforceError";
  }
}

export interface QueryResult<T> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: T[];
}

export interface SObjectResult {
  id: string;
  success: boolean;
  errors: Array<{ statusCode: string; message: string; fields: string[] }>;
}

export interface DescribeField {
  name: string;
  label: string;
  type: string;
  length?: number;
  nillable: boolean;
  createable: boolean;
  updateable: boolean;
  defaultedOnCreate: boolean;
  picklistValues?: Array<{ label: string; value: string; active: boolean }>;
  referenceTo?: string[];
}

export interface DescribeSObject {
  name: string;
  label: string;
  custom: boolean;
  createable: boolean;
  fields: DescribeField[];
}

export class SalesforceClient {
  private auth?: OrgAuth;
  private authPromise?: Promise<OrgAuth>;

  constructor(private readonly orgIdentifier = process.env.JFORM_SF_ORG) {}

  /** Resolve (and cache) credentials from the Salesforce CLI. */
  async getAuth(force = false): Promise<OrgAuth> {
    if (this.auth && !force) return this.auth;
    if (!this.authPromise) {
      this.authPromise = this.loadAuthFromCli().finally(() => {
        this.authPromise = undefined;
      });
    }
    this.auth = await this.authPromise;
    return this.auth;
  }

  private async loadAuthFromCli(): Promise<OrgAuth> {
    const args = ["org", "display", "--json"];
    if (this.orgIdentifier) args.push("-o", this.orgIdentifier);
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("sf", args, {
        maxBuffer: 1024 * 1024,
        timeout: CLI_TIMEOUT_MS,
        env: { ...process.env, SF_DISABLE_AUTOUPDATE: "true", SF_AUTOUPDATE_DISABLE: "true" },
      }));
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      if (e.code === "ENOENT") {
        throw new Error(
          "Salesforce CLI (`sf`) was not found on PATH. Install it from https://developer.salesforce.com/tools/salesforcecli and run `sf org login web`.",
        );
      }
      const detail = tryParseCliError(e.stdout) ?? e.stderr ?? e.message;
      throw new Error(`Could not read org credentials from the Salesforce CLI: ${detail}`);
    }
    const parsed = JSON.parse(stdout) as {
      status: number;
      message?: string;
      result?: {
        accessToken?: string;
        instanceUrl?: string;
        apiVersion?: string;
        username?: string;
        alias?: string;
        connectedStatus?: string;
      };
    };
    if (parsed.status !== 0 || !parsed.result?.instanceUrl) {
      throw new Error(
        `Salesforce CLI did not return credentials${this.orgIdentifier ? ` for org "${this.orgIdentifier}"` : ""}: ${parsed.message ?? "unknown error"}. Run \`sf org login web${this.orgIdentifier ? ` -a ${this.orgIdentifier}` : ""}\` first.`,
      );
    }
    const r = parsed.result;
    const instanceUrl = r.instanceUrl!.replace(/\/$/, "");
    // CLI 2.15x+ redacts accessToken in `org display`; `org auth show-access-token`
    // returns the live (auto-refreshed) token for the same org.
    let accessToken = r.accessToken && !r.accessToken.startsWith("[") ? r.accessToken : undefined;
    if (!accessToken) {
      accessToken = await this.showAccessToken(r.username ?? this.orgIdentifier);
    }
    return {
      accessToken,
      instanceUrl,
      apiVersion: r.apiVersion ?? "64.0",
      username: r.username ?? "",
      alias: r.alias,
    };
  }

  private async showAccessToken(org?: string): Promise<string> {
    const args = ["org", "auth", "show-access-token", "--json", "--no-prompt"];
    if (org) args.push("-o", org);
    try {
      const { stdout } = await execFileAsync("sf", args, {
        maxBuffer: 1024 * 1024,
        timeout: CLI_TIMEOUT_MS,
        env: { ...process.env, SF_DISABLE_AUTOUPDATE: "true", SF_AUTOUPDATE_DISABLE: "true" },
      });
      const parsed = JSON.parse(stdout) as { status: number; message?: string; result?: { accessToken?: string } };
      if (parsed.status !== 0 || !parsed.result?.accessToken) {
        throw new Error(parsed.message ?? "no access token in response");
      }
      return parsed.result.accessToken;
    } catch (err) {
      const e = err as Error & { stdout?: string; stderr?: string };
      const detail = tryParseCliError(e.stdout) ?? e.stderr ?? e.message;
      throw new Error(`Could not obtain an access token from the Salesforce CLI (sf org auth show-access-token): ${detail}`);
    }
  }

  /** Perform an authenticated request against /services/data/vXX.X{path}. */
  async request<T>(method: string, path: string, body?: unknown, retryOn401 = true): Promise<T> {
    const auth = await this.getAuth();
    const url = path.startsWith("http") ? path : `${auth.instanceUrl}/services/data/v${auth.apiVersion}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        method,
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        throw new Error(`Salesforce did not answer ${method} ${path} within ${REQUEST_TIMEOUT_MS / 1000}s.`);
      }
      throw err;
    }
    if (res.status === 401 && retryOn401) {
      await this.getAuth(true);
      return this.request<T>(method, path, body, false);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = text;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      /* keep raw text */
    }
    if (!res.ok) {
      const first = Array.isArray(json) ? json[0] : json;
      const message =
        (first as { message?: string })?.message ?? `${res.status} ${res.statusText}`;
      const errorCode = (first as { errorCode?: string })?.errorCode;
      throw new SalesforceError(`${method} ${path} failed: ${message}`, res.status, errorCode, json);
    }
    return json as T;
  }

  /**
   * Base path of the JForm Apex REST API: "jform/v1" where JForm is installed as the managed
   * package (namespace jform), "v1" where it was deployed from source. JFORM_API_PATH pins it;
   * otherwise the first call tries the package path, falls back once, and remembers the answer.
   */
  private apiPath?: string = process.env.JFORM_API_PATH?.replace(/^\/+|\/+$/g, "") || undefined;

  /** Call the JForm Apex REST API: /services/apexrest/{jform/v1 | v1}{path}. */
  async apex<T>(method: string, path: string, body?: unknown): Promise<T> {
    const auth = await this.getAuth();
    const candidates = this.apiPath ? [this.apiPath] : ["jform/v1", "v1"];
    let lastError: unknown;
    for (const base of candidates) {
      try {
        const result = await this.request<T>(method, `${auth.instanceUrl}/services/apexrest/${base}${path}`, body);
        this.apiPath = base;
        return result;
      } catch (err) {
        lastError = err;
        const detail = err instanceof SalesforceError ? (err.body as { message?: string } | undefined)?.message ?? err.message : "";
        const noSuchUrl = err instanceof SalesforceError && err.status === 404 && err.errorCode === "NOT_FOUND" && detail.startsWith("Could not find");
        if (noSuchUrl && !this.apiPath) continue; // try the other base path
        break;
      }
    }
    const err = lastError;
    if (err instanceof SalesforceError) {
      const detail = (err.body as { message?: string } | undefined)?.message ?? err.message;
      const hint = err.status === 404 && err.errorCode === "NOT_FOUND" && detail.startsWith("Could not find")
        ? " Install the JForm package, or deploy the JFormRestApi Apex class (jform-core), in this org."
        : "";
      throw new SalesforceError(`${method} ${path.split("?")[0]} failed: ${detail}${hint}`, err.status, err.errorCode, err.body);
    }
    throw err;
  }

  /** Run a SOQL query and follow nextRecordsUrl until done. */
  async query<T>(soql: string): Promise<T[]> {
    let result = await this.request<QueryResult<T>>("GET", `/query?q=${encodeURIComponent(soql)}`);
    const records = [...result.records];
    while (!result.done && result.nextRecordsUrl) {
      const auth = await this.getAuth();
      result = await this.request<QueryResult<T>>("GET", `${auth.instanceUrl}${result.nextRecordsUrl}`);
      records.push(...result.records);
    }
    return records;
  }

  async create(sobject: string, record: Record<string, unknown>): Promise<string> {
    const res = await this.request<{ id: string; success: boolean; errors: unknown[] }>(
      "POST",
      `/sobjects/${sobject}`,
      record,
    );
    return res.id;
  }

  /**
   * Insert up to 200 records in one call via the sObject Collections API.
   * allOrNone makes Salesforce roll back the whole batch if any record fails.
   */
  async createMany(sobject: string, records: Array<Record<string, unknown>>): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < records.length; i += 200) {
      const chunk = records.slice(i, i + 200).map((r) => ({ attributes: { type: sobject }, ...r }));
      const res = await this.request<SObjectResult[]>("POST", "/composite/sobjects", {
        allOrNone: true,
        records: chunk,
      });
      const failed = res.filter((r) => !r.success);
      if (failed.length) {
        const msg = failed
          .map((f) => f.errors.map((e) => `${e.statusCode}: ${e.message}${e.fields?.length ? ` [${e.fields.join(", ")}]` : ""}`).join("; "))
          .join(" | ");
        throw new SalesforceError(`Insert into ${sobject} failed: ${msg}`, 400, "COLLECTION_INSERT_FAILED", res);
      }
      ids.push(...res.map((r) => r.id));
    }
    return ids;
  }

  async update(sobject: string, id: string, record: Record<string, unknown>): Promise<void> {
    await this.request<void>("PATCH", `/sobjects/${sobject}/${id}`, record);
  }

  async delete(sobject: string, id: string): Promise<void> {
    await this.request<void>("DELETE", `/sobjects/${sobject}/${id}`);
  }

  async describe(sobject: string): Promise<DescribeSObject> {
    return this.request<DescribeSObject>("GET", `/sobjects/${sobject}/describe`);
  }

  async describeGlobal(): Promise<Array<{ name: string; label: string; custom: boolean; createable: boolean; queryable: boolean }>> {
    const res = await this.request<{ sobjects: Array<{ name: string; label: string; custom: boolean; createable: boolean; queryable: boolean }> }>(
      "GET",
      "/sobjects",
    );
    return res.sobjects;
  }
}

function tryParseCliError(stdout?: string): string | undefined {
  if (!stdout) return undefined;
  try {
    const parsed = JSON.parse(stdout) as { message?: string; name?: string };
    return parsed.message ? `${parsed.name ?? "Error"}: ${parsed.message}` : undefined;
  } catch {
    return undefined;
  }
}

/** Escape a string for use inside a single-quoted SOQL literal. */
export function soqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const SF_ID = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
export function assertSalesforceId(value: string, what = "record Id"): string {
  if (!SF_ID.test(value)) throw new Error(`"${value}" is not a valid Salesforce ${what}.`);
  return value;
}

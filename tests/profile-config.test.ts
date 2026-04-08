import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  augmentToolWithProfile,
  getEffectiveProfileName,
  getRefreshToken,
  getRefreshTokenForProfile,
  isReadOnly,
  listConfiguredProfilesTool,
  loadProfiles,
  publicToolsDefinition,
  resolveNamespace,
  resolveOrganizationName,
  summarizeProfiles,
  type SpotProfileConfig,
} from "../src/index.js";

describe("rackspace spot profile support", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete process.env.RACKSPACE_SPOT_READ_ONLY;
    delete process.env.RACKSPACE_SPOT_REFRESH_TOKEN;
    delete process.env.RACKSPACE_SPOT_PROFILES;
    delete process.env.RACKSPACE_SPOT_DEFAULT_PROFILE;
    delete process.env.RACKSPACE_SPOT_TOKEN_GECCKIO;
    delete process.env.RACKSPACE_SPOT_TOKEN_PITCHLANE;
  });

  it("detects read-only mode from env", () => {
    expect(isReadOnly()).toBe(false);
    vi.stubEnv("RACKSPACE_SPOT_READ_ONLY", "true");
    expect(isReadOnly()).toBe(true);
    vi.stubEnv("RACKSPACE_SPOT_READ_ONLY", "1");
    expect(isReadOnly()).toBe(true);
    vi.stubEnv("RACKSPACE_SPOT_READ_ONLY", "false");
    expect(isReadOnly()).toBe(false);
  });

  it("loads no profiles when env is absent", () => {
    expect(loadProfiles()).toEqual({});
  });

  it("loads valid profile JSON", () => {
    vi.stubEnv(
      "RACKSPACE_SPOT_PROFILES",
      JSON.stringify({
        gecckio: {
          tokenEnv: "RACKSPACE_SPOT_TOKEN_GECCKIO",
          defaultNamespace: "org-gecckio",
          defaultOrganizationName: "gecckio",
        },
      })
    );

    expect(loadProfiles()).toEqual({
      gecckio: {
        tokenEnv: "RACKSPACE_SPOT_TOKEN_GECCKIO",
        defaultNamespace: "org-gecckio",
        defaultOrganizationName: "gecckio",
      },
    });
  });

  it("rejects invalid profile JSON", () => {
    vi.stubEnv("RACKSPACE_SPOT_PROFILES", "not-json");
    expect(() => loadProfiles()).toThrow(/must be valid JSON/i);
  });

  it("rejects non-object profile JSON", () => {
    vi.stubEnv("RACKSPACE_SPOT_PROFILES", '["bad"]');
    expect(() => loadProfiles()).toThrow(/must be a JSON object/i);
  });

  it("resolves effective profile from explicit, default, or sole profile", () => {
    const profiles: Record<string, SpotProfileConfig> = {
      gecckio: {},
      pitchlane: {},
    };

    expect(getEffectiveProfileName("gecckio", profiles)).toBe("gecckio");

    vi.stubEnv("RACKSPACE_SPOT_DEFAULT_PROFILE", "pitchlane");
    expect(getEffectiveProfileName(undefined, profiles)).toBe("pitchlane");

    vi.unstubAllEnvs();
    expect(getEffectiveProfileName(undefined, { gecckio: {} })).toBe("gecckio");
    expect(getEffectiveProfileName(undefined, profiles)).toBeUndefined();
  });

  it("errors on unknown explicit or default profile", () => {
    const profiles: Record<string, SpotProfileConfig> = { gecckio: {} };
    expect(() => getEffectiveProfileName("missing", profiles)).toThrow(/unknown rackspace spot profile/i);

    vi.stubEnv("RACKSPACE_SPOT_DEFAULT_PROFILE", "missing");
    expect(() => getEffectiveProfileName(undefined, profiles)).toThrow(/default_profile/i);
  });

  it("gets legacy refresh token", () => {
    vi.stubEnv("RACKSPACE_SPOT_REFRESH_TOKEN", "legacy-token");
    expect(getRefreshToken()).toBe("legacy-token");
  });

  it("errors when legacy refresh token is missing", () => {
    expect(() => getRefreshToken()).toThrow(/RACKSPACE_SPOT_REFRESH_TOKEN/);
  });

  it("gets profile refresh token from tokenEnv, inline token, or legacy fallback", () => {
    const profiles: Record<string, SpotProfileConfig> = {
      gecckio: { tokenEnv: "RACKSPACE_SPOT_TOKEN_GECCKIO" },
      pitchlane: { refreshToken: "inline-token" },
      shared: {},
    };

    vi.stubEnv("RACKSPACE_SPOT_TOKEN_GECCKIO", "env-token");
    expect(getRefreshTokenForProfile("gecckio", profiles)).toBe("env-token");
    expect(getRefreshTokenForProfile("pitchlane", profiles)).toBe("inline-token");

    vi.stubEnv("RACKSPACE_SPOT_REFRESH_TOKEN", "legacy-token");
    expect(getRefreshTokenForProfile("shared", profiles)).toBe("legacy-token");
  });

  it("errors when profile token env is missing or profile is unknown", () => {
    const profiles: Record<string, SpotProfileConfig> = {
      gecckio: { tokenEnv: "RACKSPACE_SPOT_TOKEN_GECCKIO" },
    };

    expect(() => getRefreshTokenForProfile("gecckio", profiles)).toThrow(/expects token env/i);
    expect(() => getRefreshTokenForProfile("missing", profiles)).toThrow(/unknown rackspace spot profile/i);
  });

  it("resolves namespace explicitly or via profile defaults", () => {
    const profiles: Record<string, SpotProfileConfig> = {
      gecckio: { defaultNamespace: "org-gecckio" },
      pitchlane: { defaultNamespace: "org-pitchlane" },
    };

    expect(resolveNamespace({ namespace: "org-explicit" }, profiles)).toBe("org-explicit");
    expect(resolveNamespace({ profile: "gecckio" }, profiles)).toBe("org-gecckio");

    vi.stubEnv("RACKSPACE_SPOT_DEFAULT_PROFILE", "pitchlane");
    expect(resolveNamespace({}, profiles)).toBe("org-pitchlane");
  });

  it("errors on namespace resolution when ambiguous or missing defaults", () => {
    const profiles: Record<string, SpotProfileConfig> = {
      gecckio: { defaultNamespace: "org-gecckio" },
      pitchlane: { defaultNamespace: "org-pitchlane" },
    };

    expect(() => resolveNamespace({}, profiles)).toThrow(/default_profile/i);
    expect(() => resolveNamespace({}, { gecckio: {} })).toThrow(/defaultNamespace/);
  });

  it("resolves organization name explicitly or via profile defaults", () => {
    const profiles: Record<string, SpotProfileConfig> = {
      gecckio: { defaultOrganizationName: "gecckio" },
    };

    expect(resolveOrganizationName({ organizationName: "explicit" }, profiles)).toBe("explicit");
    expect(resolveOrganizationName({ profile: "gecckio" }, profiles)).toBe("gecckio");
  });

  it("errors on organization name resolution when missing defaults", () => {
    expect(() => resolveOrganizationName({}, { gecckio: {} })).toThrow(/defaultOrganizationName/);
  });

  it("summarizes configured profiles without exposing raw tokens", () => {
    const summary = summarizeProfiles({
      gecckio: {
        tokenEnv: "RACKSPACE_SPOT_TOKEN_GECCKIO",
        defaultNamespace: "org-gecckio",
        defaultOrganizationName: "gecckio",
      },
      pitchlane: {
        refreshToken: "inline-secret",
      },
      shared: {},
    });

    expect(summary).toEqual([
      {
        name: "gecckio",
        tokenEnv: "RACKSPACE_SPOT_TOKEN_GECCKIO",
        usesInlineRefreshToken: false,
        fallsBackToLegacyRefreshToken: false,
        defaultNamespace: "org-gecckio",
        defaultOrganizationName: "gecckio",
      },
      {
        name: "pitchlane",
        tokenEnv: null,
        usesInlineRefreshToken: true,
        fallsBackToLegacyRefreshToken: false,
        defaultNamespace: null,
        defaultOrganizationName: null,
      },
      {
        name: "shared",
        tokenEnv: null,
        usesInlineRefreshToken: false,
        fallsBackToLegacyRefreshToken: true,
        defaultNamespace: null,
        defaultOrganizationName: null,
      },
    ]);
  });

  it("augments tools with optional profile support and compatibility", () => {
    const cloudspaceTool = augmentToolWithProfile({
      name: "list_cloudspaces",
      description: "List cloudspaces.",
      inputSchema: {
        type: "object",
        properties: {
          namespace: { type: "string", description: "Organization namespace" },
        },
        required: ["namespace"],
      },
    });

    expect(cloudspaceTool.inputSchema.properties).toHaveProperty("profile");
    expect(cloudspaceTool.inputSchema.required).not.toContain("namespace");
    expect(cloudspaceTool.inputSchema.properties.namespace.description).toContain("defaultNamespace");

    const kubeconfigTool = augmentToolWithProfile({
      name: "get_kubeconfig",
      description: "Get kubeconfig.",
      inputSchema: {
        type: "object",
        properties: {
          organizationName: { type: "string", description: "Organization name" },
          cloudspaceName: { type: "string", description: "Cloudspace name" },
        },
        required: ["organizationName", "cloudspaceName"],
      },
    });
    expect(kubeconfigTool.inputSchema.required).toEqual(["cloudspaceName"]);

    const passthroughTool = augmentToolWithProfile(listConfiguredProfilesTool);
    expect(passthroughTool).toEqual(listConfiguredProfilesTool);
  });

  it("exposes profile discovery in the public tool definition", () => {
    expect(publicToolsDefinition[0]).toEqual(listConfiguredProfilesTool);
    const names = publicToolsDefinition.map((tool) => tool.name);
    expect(names).toContain("list_configured_profiles");
    expect(names).toContain("list_organizations");
  });
});

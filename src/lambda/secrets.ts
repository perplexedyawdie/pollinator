import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});

// Loads SecureString parameters named by *_PARAM env vars into process.env
// once per cold start, so secrets never sit in the function's configuration.
const PARAMS: Record<string, string> = {
  SEAL_KEY: "SEAL_KEY_PARAM",
  CLAUDE_API_KEY: "CLAUDE_API_KEY_PARAM",
};

let loaded: Promise<void> | undefined;

export function loadSecrets(): Promise<void> {
  loaded ??= Promise.all(
    Object.entries(PARAMS).map(async ([envName, paramEnv]) => {
      const name = process.env[paramEnv];
      if (!name || process.env[envName]) return;
      const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
      if (res.Parameter?.Value) process.env[envName] = res.Parameter.Value;
    }),
  ).then(() => undefined);
  return loaded;
}

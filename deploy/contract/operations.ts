import type { Manifest } from './artifact.ts';
import type { TargetPolicy } from './policy.ts';

/** An artifact directory holds the web root in `web/` and `manifest.json`. */
export interface Artifact {
  dir: string;
  manifest: Manifest;
}

export interface Outcome {
  releaseId: string;
  commit: string;
}

/** The host's view of the target: what is live and what rollback may return to. */
export interface Inspection {
  active?: { releaseId: string; commit: string };
  retained: string[];
}

export interface DeployOperations {
  deploy(artifact: Artifact, policy: TargetPolicy): Promise<Outcome>;
  rollback(
    artifact: Artifact,
    releaseId: string,
    policy: TargetPolicy,
  ): Promise<Outcome>;
  inspect(policy: TargetPolicy): Promise<Inspection>;
}

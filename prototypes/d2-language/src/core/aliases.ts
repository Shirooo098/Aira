import { normalize, type Product } from "./language";

export type AliasProposal = {
  alias: string;
  productId: string;
  productName: string;
};

export type AliasProposalResult =
  | { kind: "review"; proposal: AliasProposal }
  | { kind: "error"; message: string };

export type AliasApprovalResult =
  | { kind: "approved"; catalog: Product[] }
  | { kind: "error"; message: string };

export function proposeAlias(
  aliasText: string,
  productId: string,
  catalog: readonly Product[],
): AliasProposalResult {
  const alias = normalize(aliasText);

  if (!alias || alias.length > 120) {
    return {
      kind: "error",
      message: "Enter an alias between 1 and 120 characters.",
    };
  }

  const matches = catalog.filter(product => product.id === productId);

  if (matches.length !== 1) {
    return {
      kind: "error",
      message: "Select one existing product.",
    };
  }

  const product = matches[0];

  return {
    kind: "review",
    proposal: {
      alias,
      productId: product.id,
      productName: product.name,
    },
  };
}

// Call only from the owner's explicit approval action.
// Preparing a proposal must never call this automatically.
export function approveAlias(
  proposal: AliasProposal,
  catalog: readonly Product[],
): AliasApprovalResult {
  // Revalidate against the latest catalog.
  const latest = proposeAlias(
    proposal.alias,
    proposal.productId,
    catalog,
  );

  if (latest.kind === "error") {
    return latest;
  }

  if (latest.proposal.productName !== proposal.productName) {
    return {
      kind: "error",
      message: "The product changed. Review the alias again.",
    };
  }

  const alias = latest.proposal.alias;

  const updatedCatalog = catalog.map(product => {
    const aliases = [...product.aliases];

    if (
      product.id === proposal.productId &&
      !aliases.some(existing => normalize(existing) === alias)
    ) {
      aliases.push(alias);
    }

    return { ...product, aliases };
  });

  return {
    kind: "approved",
    catalog: updatedCatalog,
  };
}
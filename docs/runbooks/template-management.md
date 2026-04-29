# Tenant Vault Template Management

## Source Directory

Tenant vault templates live in `phase0/templates/vault-template/`.

`phase0/tenants/<tenant>/vault/` is the source of truth after tenant creation. The Obsidian path is only a symlink view.

Template source files are reviewed as product architecture, not as disposable scaffolding. A tenant vault created from the template becomes customer memory and is preserved as history.

## Light Interpolation

`phase0/scripts/new-tenant.sh <tenant-id> [p4-blueprint.json]` copies the template once, then replaces `{{PLACEHOLDER}}` tokens in markdown, JSON, YAML, and text files.

Supported placeholders:

| Placeholder | Source | Fallback |
|---|---|---|
| `{{TENANT_ID}}` | CLI tenant id | tenant id |
| `{{TENANT_NAME}}` | `tenant_name` / `customer_name` | tenant id |
| `{{ROLE}}` | `soul_draft.role` | `[missing: ROLE]` |
| `{{DELIVERY_MODE}}` | `delivery_mode` | `[missing: DELIVERY_MODE]` |
| `{{AGENT_NAME}}` | `soul_draft.name` | `[missing: AGENT_NAME]` |
| `{{TONE}}` | `soul_draft.tone` | `[missing: TONE]` |
| `{{FORBIDDEN_RULES}}` | `soul_draft.forbidden` or `boundary_draft` | `[missing: FORBIDDEN_RULES]` |
| `{{BOUNDARY_RULES}}` | `boundary_draft` | `[missing: BOUNDARY_RULES]` |
| `{{UAT_CRITERIA}}` | `uat_criteria` | `[missing: UAT_CRITERIA]` |
| `{{SKILL_LIST}}` | `skills_blueprint` / `skill_candidates` | `[missing: SKILL_LIST]` |
| `{{GENERATED_AT}}` | new-tenant runtime | ISO timestamp |

Unknown uppercase placeholders are replaced with `[missing: PLACEHOLDER]` so markdown remains readable and the provisioning command does not fail on optional fields.

## Usage Rules

- Use uppercase snake case placeholders only, for example `{{TENANT_NAME}}`.
- Keep placeholders as whole markdown values or table-cell values where possible.
- Do not rely on interpolation for secrets.
- Re-running `new-tenant.sh` does not re-copy or migrate an existing tenant vault.

## Governance

- Template changes must go through PR review before merge.
- The default reviewer is 大管家 unless Clare assigns a different architecture reviewer.
- 已 tenant 不自动迁移. Existing tenant vaults keep their historical customer memory and must not be rewritten just because the template changed.
- If a live tenant needs a template-derived update, create an explicit tenant migration PR with before/after evidence.
- When more than 3 customers are live, revisit customer-type variant splitting as a Phase 1b decision point.
- Phase 1b variant candidates should be named by customer type, for example `customer-type variant` templates for research, ops, or media-intel tenants.

## Review Checklist

- The source directory remains `phase0/templates/vault-template/`.
- New placeholders are added to the table above with source and fallback.
- Markdown files still render when optional blueprint values are absent.
- No secrets or tenant-specific customer memory are committed into the template.
- The change does not imply automatic migration for existing tenants.

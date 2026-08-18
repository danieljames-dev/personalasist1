# AION Current Directive

Directive-ID: <stable identifier>
Status: PENDING_OWNER_AUTHORIZATION
Title: <short title>
Prepared-Date: <UTC timestamp>
Prepared-By: CTO
Repository-Baseline: <expected commit>
Required-Authorization-Phrase: <exact phrase>
# Optional repair-only metadata:
# Authorization-Class: NORMAL | BROKEN_BASELINE_REPAIR
# Known-Failing-Gate: <allowlisted gate id, no commands>
# Allowed-Repair-Files: <optional semicolon-separated exact repo-relative subset>
# Optional standing-authority metadata:
# Milestone-Id: <stable milestone id>
# Owner-Authorization-Id: <durable owner auth id>
# Authorized-Objective: <exact objective>
# Authority-Source: OWNER_STANDING_AUTHORITY_V1
# Fresh-Owner-Approval-Required: YES | NO

## Goal

## Authorized Scope

## Prohibited Scope

## Required Inputs

## Baseline Checks

## Required Work

## Verification

## Commit and Push Authorization

## Backup Authorization

## Stop Conditions

## Required Handoff

## Next-Phase Prohibition

Allowed statuses are `PENDING_OWNER_AUTHORIZATION`, `AUTHORIZED`, `RUNNING`,
`AWAITING_CTO_REVIEW`, `BLOCKED`, `FAILED`, `SUPERSEDED`, and repair-only `CLOSED`.
Codex must never authorize itself.

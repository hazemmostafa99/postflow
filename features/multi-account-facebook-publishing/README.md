# Multi-Account Facebook Publishing

This folder contains the implementation plan and progress tracking for adding multi-account Facebook publishing support to the existing browser extension.

## Files

- [FEATURE.md](./FEATURE.md) — feature scope, architecture, constraints, and implementation requirements.
- [IN_PROGRESS.md](./IN_PROGRESS.md) — phased execution checklist and progress tracker.

## Core idea

The same extension codebase should support multiple independent extension instances, where each instance runs inside a separate Chrome Profile and is linked to a single Facebook account.

Different extension instances should be able to process their own publishing jobs in parallel, while publishing remains sequential inside each individual Facebook account/session.

## Important implementation rule

Before changing code, inspect the current implementation and build on top of it. Avoid rewriting working publishing, group collection, queue, or post-detection logic unless a change is strictly required.

# Security Policy

## Supported versions

This is a personal project; only the **latest release** is supported. Please update before reporting.

## The secrets guarantee

Claude Total Recall is built so that **secrets never leave your machine**:

- A hard guard excludes `.credentials.json`, `.claude.json`, and `*.jsonl` (Claude Code transcripts)
  from every sync, regardless of configuration.
- Defense in depth: the memories repo is created with a `.gitignore` that also excludes those files.
- Your memories live in a **private** GitHub repo that you own and control — nothing is sent anywhere
  else.

If you configure a project or a pinned file, only the paths you explicitly declare are synced, and
the secret exclusions above still apply on top.

## Reporting a vulnerability

If you believe you've found a security issue — for example, a way to make a secret sync that
shouldn't — please **do not open a public issue**. Instead, use GitHub's private
[**Report a vulnerability**](https://github.com/MrBurcha/ClaudeTotalRecall/security/advisories/new)
flow (the repo's **Security → Advisories** tab) so it can be handled privately. Thanks for helping
keep users safe.

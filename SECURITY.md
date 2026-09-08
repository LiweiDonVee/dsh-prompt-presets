# Security and data

This plugin executes with the DSH host's permissions. Its own API is loopback-only and delegates authentication/host-origin checks to DSH 0.1.2-rc.1.

Imported scripts are never executed. Supported variable macros are bounded. Private prompt text and session bindings are stored locally, without encryption by this plugin. Use trusted storage and protect backups. Do not attach private profiles, credentials or session histories to public issues.

Report vulnerabilities using GitHub private vulnerability reporting. No formal security audit or future DSH compatibility is claimed.

# R6.5 Elevated Operator Broker

## Status

- Implemented: YES (source + synthetic tests)
- Installed as Windows service: NO
- Activated: NO
- UAC disabled: NO
- Owner password stored: NO
- Arbitrary elevated PowerShell exposed: NO
- High-consequence ops independently gated: YES
- Unattended routine elevation after future activation: YES (designed)

## IPC

Named pipe contract: `\\.\pipe\AION-ElevatedOperatorBroker-v1` (HMAC-framed messages).
No public TCP listener.

## Service account

Virtual service account / NT SERVICE style; LocalSystem not default.

## Activation

Deferred to R6.5.1 after independent Claude acceptance.

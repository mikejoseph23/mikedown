# Security

Acme's basic security rules for every engineer.

## Passwords

Use the company password manager. Passwords are at least 16 characters and never reused. Multi-factor sign-in is required for every system that supports it.

## Key rotation

Rotate every API key and access key every 90 days, and immediately if one may have leaked.

1. Open the key's page in the cloud console and create a second key.
2. Update the secret store entry with the new key and redeploy the services that read it.
3. Check the logs for the old key being used. When there is none for 24 hours, disable the old key.
4. Delete the old key after seven days and record the rotation in the access tracker.

Never paste a key into chat, a ticket or a document.

## Reporting an incident

Email the security desk or page the on-call engineer. Say what you saw, when, and which systems are involved. Do not try to clean up first.

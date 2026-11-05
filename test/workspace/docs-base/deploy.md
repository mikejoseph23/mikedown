# Deploying

How a release goes out at Acme.

## Release steps

Merge to the main branch, wait for the pipeline to go green, then promote the build to production from the release dashboard. Roll back with the same dashboard if error rates rise within the first hour.

## Legacy credentials

NOTE: this key is FAKE. It is AWS's documented example key, kept here only so MikeDown's secrets scan has something to catch. It opens nothing.

```
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
```

The old deploy account used this key before the move to short-lived credentials. See [Security](security.md) for how keys are rotated now.

# ADR 0004: Skeleton-first release discipline

Status: accepted.

All target subsystems receive strict contracts, disabled adapters, deterministic fakes, tests, and visible feature-state metadata before live behavior is enabled.

Unimplemented capabilities are not advertised to a model or Minecraft bridge. The foundation branch may produce a Vercel preview, but live Minecraft installation and production deployment require separate acceptance evidence and review.

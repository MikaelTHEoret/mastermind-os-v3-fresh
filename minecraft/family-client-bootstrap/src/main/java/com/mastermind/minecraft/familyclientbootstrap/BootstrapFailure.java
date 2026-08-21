package com.mastermind.minecraft.familyclientbootstrap;

/** A deliberately non-sensitive bootstrap failure suitable for local diagnostics. */
final class BootstrapFailure extends Exception {
    private static final long serialVersionUID = 1L;

    enum Kind {
        CREDENTIAL_FRAME_INVALID(65),
        PROFILE_INVALID(64),
        FABRIC_ENTRYPOINT_UNAVAILABLE(70),
        FABRIC_ENTRYPOINT_FAILED(70);

        private final int exitStatus;

        Kind(int exitStatus) {
            this.exitStatus = exitStatus;
        }

        int exitStatus() {
            return exitStatus;
        }
    }

    private final Kind kind;

    BootstrapFailure(Kind kind, String safeMessage) {
        super(safeMessage);
        this.kind = kind;
    }

    Kind kind() {
        return kind;
    }

    int exitStatus() {
        return kind.exitStatus();
    }
}

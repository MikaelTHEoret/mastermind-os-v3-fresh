package com.mastermind.minecraft.handback;

import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

public record HandbackAttestation(
    UUID serverSessionId,
    UUID companionUuid,
    long sequence,
    long observedAtEpochMillis,
    String dimension,
    double x,
    double y,
    double z,
    boolean playerPresent,
    boolean alive,
    boolean onGround
) {
    private static final Pattern DIMENSION = Pattern.compile("[a-z0-9_.-]{1,64}:[a-z0-9_./-]{1,64}");
    private static final double MAX_COORDINATE = 30_000_000.0;

    public HandbackAttestation {
        Objects.requireNonNull(serverSessionId, "serverSessionId");
        Objects.requireNonNull(companionUuid, "companionUuid");
        if (sequence < 1) throw new IllegalArgumentException("sequence must be positive");
        if (observedAtEpochMillis < 1) throw new IllegalArgumentException("observedAtEpochMillis must be positive");
        if (dimension == null || !DIMENSION.matcher(dimension).matches()) {
            throw new IllegalArgumentException("dimension is invalid");
        }
        requireCoordinate(x, "x");
        requireCoordinate(y, "y");
        requireCoordinate(z, "z");
        if (!playerPresent && (alive || onGround)) {
            throw new IllegalArgumentException("an absent player cannot be alive or on ground");
        }
    }

    private static void requireCoordinate(double value, String label) {
        if (!Double.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
            throw new IllegalArgumentException(label + " is invalid");
        }
    }
}

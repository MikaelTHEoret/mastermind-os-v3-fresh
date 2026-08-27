package com.mastermind.minecraft.zenith.control;

import java.time.Instant;
import java.util.UUID;

public record ControlLeaseSnapshot(
    BodyDriver driver,
    UUID controllerUuid,
    boolean controllerSocketPresent,
    boolean authenticated,
    boolean rejected,
    Instant changedAt,
    Instant stableSince
) {
}

package com.mastermind.minecraft.zenith.control;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Fail-closed policy for the pre-controller-admission hook that stock Zenith does not yet expose.
 * This policy must run only after Zenith has authenticated the candidate profile and before the
 * current-player compare-and-set in SLoginFinishedOutgoingHandler.
 */
public final class ControllerAdmissionPolicy {
    private final boolean enhancedControllerEnabled;
    private final boolean parentTakeoverEnabled;
    private final UUID serviceControllerUuid;
    private final Set<UUID> parentControllerUuids;

    public ControllerAdmissionPolicy(
        boolean enhancedControllerEnabled,
        boolean parentTakeoverEnabled,
        UUID serviceControllerUuid,
        Set<UUID> parentControllerUuids
    ) {
        this.enhancedControllerEnabled = enhancedControllerEnabled;
        this.parentTakeoverEnabled = parentTakeoverEnabled;
        this.serviceControllerUuid = serviceControllerUuid;
        this.parentControllerUuids = Set.copyOf(parentControllerUuids);
    }

    public Decision decide(boolean authenticationComplete, UUID candidateUuid, UUID currentControllerUuid) {
        if (!authenticationComplete) {
            return Decision.REJECT_UNAUTHENTICATED;
        }
        Objects.requireNonNull(candidateUuid, "candidateUuid");

        ControllerRole candidate = classify(candidateUuid);
        if (candidate == ControllerRole.UNKNOWN) {
            return Decision.REJECT_UNAUTHORIZED;
        }
        if (currentControllerUuid == null) {
            return Decision.ADMIT;
        }

        ControllerRole current = classify(currentControllerUuid);
        if (candidate == ControllerRole.PARENT && current == ControllerRole.SERVICE) {
            return Decision.PREEMPT_SERVICE_AND_ADMIT_PARENT;
        }
        return Decision.REJECT_OCCUPIED;
    }

    private ControllerRole classify(UUID controllerUuid) {
        if (parentTakeoverEnabled && parentControllerUuids.contains(controllerUuid)) {
            return ControllerRole.PARENT;
        }
        if (enhancedControllerEnabled && controllerUuid.equals(serviceControllerUuid)) {
            return ControllerRole.SERVICE;
        }
        return ControllerRole.UNKNOWN;
    }

    public enum Decision {
        ADMIT,
        PREEMPT_SERVICE_AND_ADMIT_PARENT,
        REJECT_UNAUTHENTICATED,
        REJECT_UNAUTHORIZED,
        REJECT_OCCUPIED
    }

    private enum ControllerRole {
        PARENT,
        SERVICE,
        UNKNOWN
    }
}

package com.mastermind.minecraft.zenith.control;

import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.UUID;

import static com.mastermind.minecraft.zenith.control.ControllerAdmissionPolicy.Decision.ADMIT;
import static com.mastermind.minecraft.zenith.control.ControllerAdmissionPolicy.Decision.PREEMPT_SERVICE_AND_ADMIT_PARENT;
import static com.mastermind.minecraft.zenith.control.ControllerAdmissionPolicy.Decision.REJECT_OCCUPIED;
import static com.mastermind.minecraft.zenith.control.ControllerAdmissionPolicy.Decision.REJECT_UNAUTHENTICATED;
import static com.mastermind.minecraft.zenith.control.ControllerAdmissionPolicy.Decision.REJECT_UNAUTHORIZED;
import static org.junit.jupiter.api.Assertions.assertEquals;

final class ControllerAdmissionPolicyTest {
    private static final UUID SERVICE = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID PARENT = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID OTHER_PARENT = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID UNKNOWN = UUID.fromString("44444444-4444-4444-8444-444444444444");

    @Test
    void admitsKnownControllersWhenTheLeaseIsEmpty() {
        var policy = enabledPolicy();
        assertEquals(ADMIT, policy.decide(true, SERVICE, null));
        assertEquals(ADMIT, policy.decide(true, PARENT, null));
    }

    @Test
    void letsAnAuthenticatedParentPreemptOnlyTheServiceController() {
        var policy = enabledPolicy();
        assertEquals(PREEMPT_SERVICE_AND_ADMIT_PARENT, policy.decide(true, PARENT, SERVICE));
        assertEquals(REJECT_OCCUPIED, policy.decide(true, PARENT, OTHER_PARENT));
    }

    @Test
    void neverLetsTheServiceDisplaceAParentOrAnotherServiceSession() {
        var policy = enabledPolicy();
        assertEquals(REJECT_OCCUPIED, policy.decide(true, SERVICE, PARENT));
        assertEquals(REJECT_OCCUPIED, policy.decide(true, SERVICE, SERVICE));
    }

    @Test
    void neverPreemptsForStatusPingsOrUnauthenticatedConnections() {
        assertEquals(REJECT_UNAUTHENTICATED, enabledPolicy().decide(false, PARENT, SERVICE));
    }

    @Test
    void rejectsUnknownAuthenticatedProfilesEvenWhenTheLeaseIsEmpty() {
        assertEquals(REJECT_UNAUTHORIZED, enabledPolicy().decide(true, UNKNOWN, null));
    }

    @Test
    void featureFlagsRemoveTheirIdentitiesFromTheAdmissionSet() {
        var disabled = new ControllerAdmissionPolicy(false, false, null, Set.of(PARENT));
        assertEquals(REJECT_UNAUTHORIZED, disabled.decide(true, SERVICE, null));
        assertEquals(REJECT_UNAUTHORIZED, disabled.decide(true, PARENT, null));
    }

    private static ControllerAdmissionPolicy enabledPolicy() {
        return new ControllerAdmissionPolicy(true, true, SERVICE, Set.of(PARENT, OTHER_PARENT));
    }
}

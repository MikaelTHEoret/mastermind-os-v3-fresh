package com.mastermind.minecraft.zenith.control;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ControlLeaseStateMachineTest {
    private static final UUID SERVICE = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID PARENT = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final Instant START = Instant.parse("2026-08-21T12:00:00.000Z");

    @Test
    void startsInNativeFallbackAndGivesParentHighestControllerRole() {
        var machine = enabledMachine();
        assertEquals(BodyDriver.ZENITH_FALLBACK, machine.snapshot().driver());
        assertEquals(BodyDriver.RECOVERY_HOLD, machine.controllerSocketConnected(START.plusSeconds(1)).driver());
        var parent = machine.controllerAuthenticated(PARENT, START.plusSeconds(2));
        assertEquals(BodyDriver.HUMAN_PARENT, parent.driver());
        assertTrue(parent.authenticated());
    }

    @Test
    void givesTheEnhancedServiceASeparateAuthenticatedLease() {
        var machine = enabledMachine();
        machine.controllerSocketConnected(START.plusSeconds(1));
        assertEquals(BodyDriver.MASTERMIND_CONTROLLER, machine.controllerAuthenticated(SERVICE, START.plusSeconds(2)).driver());
    }

    @Test
    void rejectsUnknownControllersAndNeverFallsThroughToEnhancedControl() {
        var machine = enabledMachine();
        machine.controllerSocketConnected(START.plusSeconds(1));
        var rejected = machine.controllerAuthenticated(UUID.fromString("33333333-3333-4333-8333-333333333333"), START.plusSeconds(2));
        assertEquals(BodyDriver.RECOVERY_HOLD, rejected.driver());
        assertTrue(rejected.rejected());
        assertFalse(rejected.authenticated());
    }

    @Test
    void handbackReturnsOnlyToFallbackAfterContinuousCorrelatedEvidence() {
        var machine = enabledMachine();
        machine.controllerSocketConnected(START.plusSeconds(1));
        machine.controllerAuthenticated(PARENT, START.plusSeconds(2));
        machine.controllerDisconnected(START.plusSeconds(3));
        var safe = new ControlLeaseStateMachine.HandbackEvidence(true, true, true, true, true);
        assertEquals(BodyDriver.RECOVERY_HOLD, machine.observeHandback(safe, START.plusSeconds(4)).driver());
        assertEquals(BodyDriver.ZENITH_FALLBACK, machine.observeHandback(safe, START.plusSeconds(6)).driver());
    }

    @Test
    void unsafeEvidenceResetsTheHandbackWindow() {
        var machine = enabledMachine();
        machine.controllerSocketConnected(START.plusSeconds(1));
        machine.controllerDisconnected(START.plusSeconds(2));
        var safe = new ControlLeaseStateMachine.HandbackEvidence(true, true, true, true, true);
        var staleServer = new ControlLeaseStateMachine.HandbackEvidence(true, true, true, false, true);
        machine.observeHandback(safe, START.plusSeconds(3));
        machine.observeHandback(staleServer, START.plusSeconds(4));
        assertEquals(BodyDriver.RECOVERY_HOLD, machine.observeHandback(safe, START.plusSeconds(5)).driver());
        assertEquals(BodyDriver.RECOVERY_HOLD, machine.observeHandback(safe, START.plusSeconds(6)).driver());
        assertEquals(BodyDriver.ZENITH_FALLBACK, machine.observeHandback(safe, START.plusSeconds(8)).driver());
    }

    @Test
    void disabledSkeletonCannotAcquireAnyLease() {
        var machine = new ControlLeaseStateMachine(false, false, false, false, null, Set.of(), Duration.ofSeconds(2), START);
        assertEquals(BodyDriver.DISABLED, machine.snapshot().driver());
        assertThrows(IllegalStateException.class, () -> machine.controllerSocketConnected(START.plusSeconds(1)));
    }

    @Test
    void outerEnableDoesNotActivateAnyIndividualDriverLane() {
        var machine = new ControlLeaseStateMachine(true, false, false, false, null, Set.of(), Duration.ofSeconds(2), START);
        assertEquals(BodyDriver.RECOVERY_HOLD, machine.snapshot().driver());
        machine.controllerSocketConnected(START.plusSeconds(1));
        var rejected = machine.controllerAuthenticated(SERVICE, START.plusSeconds(2));
        assertEquals(BodyDriver.RECOVERY_HOLD, rejected.driver());
        assertTrue(rejected.rejected());
        machine.controllerDisconnected(START.plusSeconds(3));
        var safe = new ControlLeaseStateMachine.HandbackEvidence(true, true, true, true, true);
        assertEquals(BodyDriver.RECOVERY_HOLD, machine.observeHandback(safe, START.plusSeconds(10)).driver());
    }

    private static ControlLeaseStateMachine enabledMachine() {
        return new ControlLeaseStateMachine(true, true, true, true, SERVICE, Set.of(PARENT), Duration.ofSeconds(2), START);
    }
}

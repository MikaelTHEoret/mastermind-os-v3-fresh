package com.mastermind.minecraft.zenith.control;

import com.mastermind.minecraft.handback.HandbackAttestation;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class PairedHandbackEvaluatorTest {
    private static final UUID COMPANION = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID SESSION = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final long NOW = 1_777_000_000_000L;

    @Test
    void requiresFreshIncreasingCorrelatedServerAndZenithEvidence() {
        PairedHandbackEvaluator evaluator = new PairedHandbackEvaluator(COMPANION, 1_500, 1.5);
        var first = evaluator.evaluate(server(1), local(), NOW);
        assertTrue(first.shouldObserve());
        assertFalse(first.evidence().safe(), "the first frame establishes session continuity but cannot release the lease");
        assertTrue(evaluator.evaluate(server(2), local(), NOW + 250).evidence().safe());
        assertFalse(evaluator.evaluate(server(2), local(), NOW + 300).shouldObserve(), "a fresh duplicate waits without resetting stability");
    }

    @Test
    void rejectsStaleMismatchedMovingDeadOrKillSwitchedEvidence() {
        assertUnsafe(server(1, NOW - 2_000, COMPANION, "minecraft:overworld", 10, 64, 20, true, true, true), local());
        assertUnsafe(server(1, NOW, UUID.fromString("33333333-3333-4333-8333-333333333333"), "minecraft:overworld", 10, 64, 20, true, true, true), local());
        assertUnsafe(server(1, NOW, COMPANION, "minecraft:the_nether", 10, 64, 20, true, true, true), local());
        assertUnsafe(server(1, NOW, COMPANION, "minecraft:overworld", 20, 64, 20, true, true, true), local());
        assertUnsafe(server(1, NOW, COMPANION, "minecraft:overworld", 10, 64, 20, true, false, false), local());
        assertUnsafe(server(1), new PairedHandbackEvaluator.LocalBodyObservation(NOW, "minecraft:overworld", 10, 64, 20, true, true, true, false, true));
        assertUnsafe(server(1), new PairedHandbackEvaluator.LocalBodyObservation(NOW, "minecraft:overworld", 10, 64, 20, true, true, true, true, false));
    }

    @Test
    void aServerRestartBreaksTheStabilitySequence() {
        PairedHandbackEvaluator evaluator = new PairedHandbackEvaluator(COMPANION, 1_500, 1.5);
        evaluator.evaluate(server(1), local(), NOW);
        assertTrue(evaluator.evaluate(server(2), local(), NOW + 250).evidence().safe());
        HandbackAttestation restarted = new HandbackAttestation(
            UUID.fromString("44444444-4444-4444-8444-444444444444"), COMPANION, 1, NOW + 500,
            "minecraft:overworld", 10, 64, 20, true, true, true
        );
        assertFalse(evaluator.evaluate(restarted, local(NOW + 500), NOW + 500).evidence().safe());
    }

    @Test
    void rejectsAReplayFromAnEarlierServerSession() {
        PairedHandbackEvaluator evaluator = new PairedHandbackEvaluator(COMPANION, 1_500, 1.5);
        evaluator.evaluate(server(1), local(), NOW);
        assertTrue(evaluator.evaluate(server(2), local(), NOW + 250).evidence().safe());
        UUID restartedSession = UUID.fromString("44444444-4444-4444-8444-444444444444");
        HandbackAttestation restarted = new HandbackAttestation(
            restartedSession, COMPANION, 1, NOW + 500,
            "minecraft:overworld", 10, 64, 20, true, true, true
        );
        evaluator.evaluate(restarted, local(NOW + 500), NOW + 500);
        HandbackAttestation advancedRestart = new HandbackAttestation(
            restartedSession, COMPANION, 2, NOW + 750,
            "minecraft:overworld", 10, 64, 20, true, true, true
        );
        assertTrue(evaluator.evaluate(advancedRestart, local(NOW + 750), NOW + 750).evidence().safe());
        HandbackAttestation replayedEarlierSession = new HandbackAttestation(
            SESSION, COMPANION, 3, NOW + 1_000,
            "minecraft:overworld", 10, 64, 20, true, true, true
        );
        assertFalse(evaluator.evaluate(replayedEarlierSession, local(NOW + 1_000), NOW + 1_000).evidence().safe());
    }

    private static void assertUnsafe(HandbackAttestation server, PairedHandbackEvaluator.LocalBodyObservation local) {
        PairedHandbackEvaluator evaluator = new PairedHandbackEvaluator(COMPANION, 1_500, 1.5);
        evaluator.evaluate(server, local, NOW);
        assertFalse(evaluator.evaluate(new HandbackAttestation(
            server.serverSessionId(), server.companionUuid(), server.sequence() + 1, server.observedAtEpochMillis(),
            server.dimension(), server.x(), server.y(), server.z(), server.playerPresent(), server.alive(), server.onGround()
        ), local, NOW).evidence().safe());
    }

    private static HandbackAttestation server(long sequence) {
        return server(sequence, NOW, COMPANION, "minecraft:overworld", 10, 64, 20, true, true, true);
    }

    private static HandbackAttestation server(
        long sequence, long observedAt, UUID companion, String dimension, double x, double y, double z,
        boolean present, boolean alive, boolean onGround
    ) {
        return new HandbackAttestation(SESSION, companion, sequence, observedAt, dimension, x, y, z, present, alive, onGround);
    }

    private static PairedHandbackEvaluator.LocalBodyObservation local() {
        return local(NOW);
    }

    private static PairedHandbackEvaluator.LocalBodyObservation local(long observedAt) {
        return new PairedHandbackEvaluator.LocalBodyObservation(
            observedAt, "minecraft:overworld", 10, 64, 20, true, true, true, true, true
        );
    }
}

package com.mastermind.minecraft.zenith.control;

import com.mastermind.minecraft.handback.HandbackAttestation;

import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

final class PairedHandbackEvaluator {
    private final UUID expectedCompanionUuid;
    private final long maximumAgeMilliseconds;
    private final double maximumPositionDeltaSquared;
    private final Set<UUID> observedServerSessions = new HashSet<>();
    private UUID serverSessionId;
    private long serverSequence;

    PairedHandbackEvaluator(UUID expectedCompanionUuid, long maximumAgeMilliseconds, double maximumPositionDelta) {
        this.expectedCompanionUuid = Objects.requireNonNull(expectedCompanionUuid, "expectedCompanionUuid");
        if (maximumAgeMilliseconds < 100 || maximumAgeMilliseconds > 60_000) {
            throw new IllegalArgumentException("maximumAgeMilliseconds is invalid");
        }
        if (!Double.isFinite(maximumPositionDelta) || maximumPositionDelta <= 0 || maximumPositionDelta > 8) {
            throw new IllegalArgumentException("maximumPositionDelta is invalid");
        }
        this.maximumAgeMilliseconds = maximumAgeMilliseconds;
        this.maximumPositionDeltaSquared = maximumPositionDelta * maximumPositionDelta;
    }

    synchronized Evaluation evaluate(
        HandbackAttestation server,
        LocalBodyObservation zenith,
        long nowEpochMillis
    ) {
        Objects.requireNonNull(server, "server");
        Objects.requireNonNull(zenith, "zenith");
        boolean identityMatches = expectedCompanionUuid.equals(server.companionUuid());
        boolean freshServer = ageIsFresh(server.observedAtEpochMillis(), nowEpochMillis);
        boolean freshZenith = ageIsFresh(zenith.observedAtEpochMillis(), nowEpochMillis) && zenith.upstreamConnected();
        SequenceDecision sequence = acceptSequence(server.serverSessionId(), server.sequence());
        boolean positionMatches = distanceSquared(server, zenith) <= maximumPositionDeltaSquared;
        boolean sourcesCorrelated = identityMatches
            && server.dimension().equals(zenith.dimension())
            && positionMatches
            && server.onGround() == zenith.onGround();
        boolean bodyIdle = zenith.bodyIdle()
            && server.playerPresent()
            && server.alive()
            && zenith.alive()
            && server.onGround()
            && zenith.onGround();
        ControlLeaseStateMachine.HandbackEvidence evidence = new ControlLeaseStateMachine.HandbackEvidence(
            zenith.killSwitchClear(),
            bodyIdle,
            freshZenith,
            freshServer && sequence == SequenceDecision.ADVANCED,
            sourcesCorrelated
        );
        boolean shouldObserve = sequence != SequenceDecision.DUPLICATE || !freshServer;
        return new Evaluation(shouldObserve, evidence);
    }

    private SequenceDecision acceptSequence(UUID nextSessionId, long nextSequence) {
        if (!nextSessionId.equals(serverSessionId)) {
            if (!observedServerSessions.add(nextSessionId)) return SequenceDecision.REPLAY;
            serverSessionId = nextSessionId;
            serverSequence = nextSequence;
            return SequenceDecision.NEW_SESSION;
        }
        if (nextSequence == serverSequence) return SequenceDecision.DUPLICATE;
        if (nextSequence < serverSequence) return SequenceDecision.REPLAY;
        serverSequence = nextSequence;
        return SequenceDecision.ADVANCED;
    }

    private boolean ageIsFresh(long observedAt, long now) {
        long age = now - observedAt;
        return age >= 0 && age <= maximumAgeMilliseconds;
    }

    private static double distanceSquared(HandbackAttestation server, LocalBodyObservation zenith) {
        double dx = server.x() - zenith.x();
        double dy = server.y() - zenith.y();
        double dz = server.z() - zenith.z();
        return dx * dx + dy * dy + dz * dz;
    }

    record LocalBodyObservation(
        long observedAtEpochMillis,
        String dimension,
        double x,
        double y,
        double z,
        boolean upstreamConnected,
        boolean alive,
        boolean onGround,
        boolean bodyIdle,
        boolean killSwitchClear
    ) {
        LocalBodyObservation {
            Objects.requireNonNull(dimension, "dimension");
        }
    }

    record Evaluation(boolean shouldObserve, ControlLeaseStateMachine.HandbackEvidence evidence) {
        Evaluation {
            Objects.requireNonNull(evidence, "evidence");
        }
    }

    private enum SequenceDecision {
        NEW_SESSION,
        ADVANCED,
        DUPLICATE,
        REPLAY
    }
}

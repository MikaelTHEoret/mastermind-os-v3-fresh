package com.mastermind.minecraft.familyagent.client;

import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.action.ActionCommand;
import com.mastermind.minecraft.familyagent.action.ActionRegistry;
import com.mastermind.minecraft.familyagent.navigation.NavigationProvider;
import com.mastermind.minecraft.familyagent.navigation.NavigationUnavailableException;
import com.mastermind.minecraft.familyagent.protocol.ClientPayloads;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.arguments.EntityAnchorArgument;
import net.minecraft.network.protocol.game.ServerboundClientCommandPacket;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.Vec3;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.BiConsumer;

final class MinecraftActionController {
    private static final int TERMINAL_REPLAY_LIMIT = 128;

    private sealed interface RunningAction permits TimedMove, TimedLook, OneTickJump, NavigationAction {
        ActionCommand command();

        void tick(long nowNanos);

        void cancel(String reason);
    }

    private final class TimedMove implements RunningAction {
        private final ActionCommand command;
        private final long endNanos;

        private TimedMove(ActionCommand command, long nowNanos) {
            this.command = command;
            var args = command.arguments();
            var forward = args.get("forward").getAsDouble();
            var strafe = args.get("strafe").getAsDouble();
            minecraft.options.keyUp.setDown(forward > 0);
            minecraft.options.keyDown.setDown(forward < 0);
            minecraft.options.keyRight.setDown(strafe > 0);
            minecraft.options.keyLeft.setDown(strafe < 0);
            minecraft.options.keySprint.setDown(args.get("sprint").getAsBoolean());
            minecraft.options.keyShift.setDown(args.get("sneak").getAsBoolean());
            endNanos = nowNanos + args.get("durationMs").getAsLong() * 1_000_000L;
        }

        @Override
        public ActionCommand command() {
            return command;
        }

        @Override
        public void tick(long nowNanos) {
            if (nowNanos >= endNanos) {
                finishSucceeded(command.actionId(), "completed");
            }
        }

        @Override
        public void cancel(String reason) {
            releaseControls();
        }
    }

    private final class TimedLook implements RunningAction {
        private final ActionCommand command;
        private final long startNanos;
        private final long endNanos;
        private final float startYaw;
        private final float startPitch;
        private final float yawDelta;
        private final float pitchDelta;

        private TimedLook(ActionCommand command, long nowNanos) {
            this.command = command;
            var player = requirePlayer();
            var args = command.arguments();
            startNanos = nowNanos;
            endNanos = nowNanos + args.get("durationMs").getAsLong() * 1_000_000L;
            startYaw = player.getYRot();
            startPitch = player.getXRot();
            float targetYaw;
            float targetPitch;
            if (command.kind().equals("direct.lookDelta")) {
                targetYaw = startYaw + args.get("yawDelta").getAsFloat();
                targetPitch = clampPitch(startPitch + args.get("pitchDelta").getAsFloat());
            } else {
                var originalYaw = startYaw;
                var originalPitch = startPitch;
                player.lookAt(EntityAnchorArgument.Anchor.EYES, new Vec3(
                    args.get("x").getAsDouble(), args.get("y").getAsDouble(), args.get("z").getAsDouble()
                ));
                targetYaw = player.getYRot();
                targetPitch = player.getXRot();
                player.setYRot(originalYaw);
                player.setXRot(originalPitch);
            }
            yawDelta = wrapDegrees(targetYaw - startYaw);
            pitchDelta = targetPitch - startPitch;
        }

        @Override
        public ActionCommand command() {
            return command;
        }

        @Override
        public void tick(long nowNanos) {
            var player = minecraft.player;
            if (player == null) {
                finishFailed(command.actionId(), "not-in-world", "The Family AI client is not in a world");
                return;
            }
            var progress = Math.min(1.0, Math.max(0.0, (double) (nowNanos - startNanos) / (double) (endNanos - startNanos)));
            player.setYRot(startYaw + yawDelta * (float) progress);
            player.setXRot(clampPitch(startPitch + pitchDelta * (float) progress));
            if (progress >= 1.0) {
                finishSucceeded(command.actionId(), "completed");
            }
        }

        @Override
        public void cancel(String reason) {
            // No key state is held by a look action.
        }
    }

    private final class OneTickJump implements RunningAction {
        private final ActionCommand command;
        private final long startNanos;

        private OneTickJump(ActionCommand command, long nowNanos) {
            this.command = command;
            this.startNanos = nowNanos;
            minecraft.options.keyJump.setDown(true);
        }

        @Override
        public ActionCommand command() {
            return command;
        }

        @Override
        public void tick(long nowNanos) {
            if (nowNanos > startNanos) {
                finishSucceeded(command.actionId(), "completed");
            }
        }

        @Override
        public void cancel(String reason) {
            minecraft.options.keyJump.setDown(false);
        }
    }

    private record NavigationAction(ActionCommand command, NavigationProvider provider) implements RunningAction {
        @Override
        public void tick(long nowNanos) {
            provider.tick();
        }

        @Override
        public void cancel(String reason) {
            provider.cancel(reason);
        }
    }

    private final Minecraft minecraft;
    private final NavigationProvider navigation;
    private final BiConsumer<String, JsonObject> outbound;
    private final int familyServerPort;
    private final ActionRegistry registry = new ActionRegistry();
    private final LinkedHashMap<UUID, JsonObject> terminalResponses = new LinkedHashMap<>();
    private RunningAction running;
    private boolean killSwitch;

    MinecraftActionController(Minecraft minecraft, NavigationProvider navigation, BiConsumer<String, JsonObject> outbound,
                              int familyServerPort) {
        this.minecraft = Objects.requireNonNull(minecraft, "minecraft");
        this.navigation = Objects.requireNonNull(navigation, "navigation");
        this.outbound = Objects.requireNonNull(outbound, "outbound");
        this.familyServerPort = familyServerPort;
    }

    ActionRegistry registry() {
        return registry;
    }

    void execute(ActionCommand command, long nowNanos) {
        if (terminalResponses.containsKey(command.actionId())) {
            replayTerminal(command.actionId());
            return;
        }
        var active = registry.active();
        if (active.isPresent() && active.orElseThrow().actionId().equals(command.actionId())) {
            send("action.status", ClientPayloads.actionStarted(command.actionId()));
            return;
        }
        if (killSwitch) {
            reject(command, "kill-switch-engaged", "The local emergency stop is latched until the client restarts");
            return;
        }
        if (Instant.now().isAfter(command.deadlineAt())) {
            reject(command, "deadline-expired", "The action deadline elapsed before execution");
            return;
        }
        if (!isFamilyWorld()) {
            reject(command, "wrong-server", "Direct actions are restricted to the local Family Server");
            return;
        }
        if (command.kind().equals("direct.say")) {
            executeSpeech(command);
            return;
        }
        var begin = registry.begin(command, reason -> cancelRunning(command.actionId(), reason));
        switch (begin) {
            case ALREADY_ACTIVE -> send("action.status", ClientPayloads.actionStarted(command.actionId()));
            case ALREADY_TERMINAL -> replayTerminal(command.actionId());
            case BUSY -> reject(command, "agent-busy", "Another foreground action is active");
            case STARTED -> start(command, nowNanos);
        }
    }

    private void executeSpeech(ActionCommand command) {
        send("action.status", ClientPayloads.actionStarted(command.actionId()));
        try {
            requireConnection().sendChat(command.arguments().get("text").getAsString());
            sendTerminal(command.actionId(), ClientPayloads.actionSucceeded(command.actionId(), "sent"));
        } catch (RuntimeException error) {
            sendTerminal(command.actionId(), ClientPayloads.actionFailed(command.actionId(), "action-failed", safeMessage(error)));
        }
    }

    private void reject(ActionCommand command, String code, String message) {
        send("action.status", ClientPayloads.actionStarted(command.actionId()));
        sendTerminal(command.actionId(), ClientPayloads.actionFailed(command.actionId(), code, message));
    }

    void cancel(UUID actionId, String reason) {
        if (!registry.cancel(actionId, reason)) {
            replayTerminal(actionId);
        }
    }

    void deadMan(String reason) {
        registry.cancelAll(reason);
        releaseControls();
        try {
            navigation.cancel(reason);
        } catch (RuntimeException ignored) {
            // Physical input release remains authoritative if a provider fails while stopping.
        }
    }

    void engageKillSwitch() {
        killSwitch = true;
        deadMan("kill-switch");
    }

    void tick(long nowNanos) {
        var active = running;
        if (active == null) {
            return;
        }
        if (Instant.now().isAfter(active.command().deadlineAt())) {
            registry.cancel(active.command().actionId(), "deadline");
            return;
        }
        active.tick(nowNanos);
    }

    private void start(ActionCommand command, long nowNanos) {
        send("action.status", ClientPayloads.actionStarted(command.actionId()));
        try {
            switch (command.kind()) {
                case "direct.respawn" -> respawn(command);
                case "direct.lookAt", "direct.lookDelta" -> running = new TimedLook(command, nowNanos);
                case "direct.moveFor" -> running = new TimedMove(command, nowNanos);
                case "direct.jump" -> running = new OneTickJump(command, nowNanos);
                case "direct.attack" -> attack(command);
                default -> startNavigation(command);
            }
        } catch (NavigationUnavailableException error) {
            finishFailed(command.actionId(), "navigation-unavailable", "Baritone navigation is not installed for Minecraft 26.2");
        } catch (RuntimeException error) {
            finishFailed(command.actionId(), "action-failed", safeMessage(error));
        }
    }

    private void attack(ActionCommand command) {
        var player = requirePlayer();
        if (!(minecraft.hitResult instanceof EntityHitResult target) || minecraft.gameMode == null) {
            finishFailed(command.actionId(), "no-target", "No attackable entity is under the crosshair");
            return;
        }
        minecraft.gameMode.attack(player, target.getEntity());
        player.swing(InteractionHand.MAIN_HAND);
        finishSucceeded(command.actionId(), "attacked");
    }

    private void respawn(ActionCommand command) {
        var player = requirePlayer();
        if (player.getHealth() > 0.0F && !player.isDeadOrDying()) {
            finishFailed(command.actionId(), "not-dead", "The companion is already alive");
            return;
        }
        requireConnection().send(new ServerboundClientCommandPacket(ServerboundClientCommandPacket.Action.PERFORM_RESPAWN));
        finishSucceeded(command.actionId(), "respawn-requested");
    }

    private void startNavigation(ActionCommand command) {
        running = new NavigationAction(command, navigation);
        navigation.start(command, new NavigationProvider.Completion() {
            @Override
            public void succeeded(String resultCode) {
                minecraft.execute(() -> finishSucceeded(command.actionId(), resultCode));
            }

            @Override
            public void failed(String errorCode, String message) {
                minecraft.execute(() -> finishFailed(command.actionId(), errorCode, message));
            }
        });
    }

    private void finishSucceeded(UUID actionId, String code) {
        if (!registry.complete(actionId, "succeeded")) {
            return;
        }
        releaseRunning(actionId, "completed");
        sendTerminal(actionId, ClientPayloads.actionSucceeded(actionId, safeCode(code, "completed")));
    }

    private void finishFailed(UUID actionId, String code, String message) {
        if (!registry.complete(actionId, "failed")) {
            return;
        }
        releaseRunning(actionId, "failed");
        sendTerminal(actionId, ClientPayloads.actionFailed(actionId, safeCode(code, "action-failed"), safeText(message)));
    }

    private void cancelRunning(UUID actionId, String reason) {
        releaseRunning(actionId, reason);
        sendTerminal(actionId, ClientPayloads.actionCancelled(actionId, reason));
    }

    private void releaseRunning(UUID actionId, String reason) {
        var active = running;
        if (active != null && active.command().actionId().equals(actionId)) {
            running = null;
            try {
                active.cancel(reason);
            } catch (RuntimeException ignored) {
                // Never let provider cleanup prevent the dead-man key release below.
            }
        }
        releaseControls();
    }

    private void releaseControls() {
        minecraft.options.keyUp.setDown(false);
        minecraft.options.keyDown.setDown(false);
        minecraft.options.keyLeft.setDown(false);
        minecraft.options.keyRight.setDown(false);
        minecraft.options.keyJump.setDown(false);
        minecraft.options.keyShift.setDown(false);
        minecraft.options.keySprint.setDown(false);
    }

    private boolean isFamilyWorld() {
        if (minecraft.player == null || minecraft.level == null || minecraft.getConnection() == null) {
            return false;
        }
        return MinecraftSnapshotCollector.isFamilyServer(minecraft, familyServerPort);
    }

    private net.minecraft.client.player.LocalPlayer requirePlayer() {
        if (minecraft.player == null) {
            throw new IllegalStateException("The Family AI client is not in a world");
        }
        return minecraft.player;
    }

    private net.minecraft.client.multiplayer.ClientPacketListener requireConnection() {
        if (minecraft.getConnection() == null) {
            throw new IllegalStateException("The Family AI client is not connected");
        }
        return minecraft.getConnection();
    }

    private void sendTerminal(UUID actionId, JsonObject payload) {
        terminalResponses.put(actionId, payload.deepCopy());
        while (terminalResponses.size() > TERMINAL_REPLAY_LIMIT) {
            terminalResponses.remove(terminalResponses.entrySet().iterator().next().getKey());
        }
        send("action.status", payload);
    }

    private void replayTerminal(UUID actionId) {
        var payload = terminalResponses.get(actionId);
        if (payload != null) {
            send("action.status", payload.deepCopy());
        }
    }

    private void send(String type, JsonObject payload) {
        outbound.accept(type, payload);
    }

    private static float wrapDegrees(float value) {
        var wrapped = value % 360.0F;
        if (wrapped >= 180.0F) wrapped -= 360.0F;
        if (wrapped < -180.0F) wrapped += 360.0F;
        return wrapped;
    }

    private static float clampPitch(float value) {
        return Math.max(-90.0F, Math.min(90.0F, value));
    }

    private static String safeCode(String value, String fallback) {
        return value != null && value.matches("^[a-z0-9][a-z0-9._-]{0,63}$") ? value : fallback;
    }

    private static String safeText(String value) {
        var text = value == null ? "Action failed" : value.replaceAll("[\\x00-\\x1f\\x7f]", " ").trim();
        if (text.isEmpty()) text = "Action failed";
        return text.length() > 512 ? text.substring(0, 512) : text;
    }

    private static String safeMessage(RuntimeException error) {
        return safeText(error.getMessage());
    }
}

package com.mastermind.minecraft.familyagent.baritone;

import baritone.api.BaritoneAPI;
import baritone.api.IBaritone;
import baritone.api.event.events.PathEvent;
import baritone.api.event.events.TickEvent;
import baritone.api.event.events.type.EventState;
import baritone.api.event.listener.AbstractGameEventListener;
import baritone.api.pathing.goals.Goal;
import baritone.api.pathing.goals.GoalNear;
import baritone.api.pathing.goals.GoalRunAway;
import baritone.api.utils.BlockOptionalMetaLookup;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.action.ActionCommand;
import com.mastermind.minecraft.familyagent.navigation.NavigationProvider;
import net.minecraft.core.BlockPos;

import java.util.Comparator;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Direct, typed Baritone API integration. No chat command, command manager,
 * shell string, path, or URL from the control protocol reaches Baritone.
 */
public final class VerifiedBaritoneNavigationProvider implements NavigationProvider, AbstractGameEventListener {
    private enum Mode {
        FIXED_GOAL,
        FOLLOW,
        GATHER,
        EXPLORE
    }

    private static final Set<String> CAPABILITIES = Set.of(
        "skill.navigateTo",
        "skill.followPlayer",
        "skill.gatherBlock",
        "skill.explore",
        "skill.escapeDanger",
        "skill.returnToKnownSafePoint"
    );
    private static final int ESCAPE_DISTANCE = 12;

    private static final class Active {
        private final ActionCommand command;
        private final Completion completion;
        private final Mode mode;
        private final JsonObject goal;
        private final BlockPos origin;
        private final int radius;
        private final BlockOptionalMetaLookup gatherFilter;
        private final int gatherTargetCount;
        private final Runnable restoreSettings;

        private Active(ActionCommand command, Completion completion, Mode mode, JsonObject goal,
                       BlockPos origin, int radius, BlockOptionalMetaLookup gatherFilter,
                       int gatherTargetCount, Runnable restoreSettings) {
            this.command = command;
            this.completion = completion;
            this.mode = mode;
            this.goal = goal;
            this.origin = origin;
            this.radius = radius;
            this.gatherFilter = gatherFilter;
            this.gatherTargetCount = gatherTargetCount;
            this.restoreSettings = restoreSettings;
        }
    }

    private final Object lock = new Object();
    private final IBaritone baritone;
    private Active active;

    public VerifiedBaritoneNavigationProvider() {
        baritone = Objects.requireNonNull(
            BaritoneAPI.getProvider().getPrimaryBaritone(),
            "Baritone primary instance is unavailable"
        );
        baritone.getGameEventHandler().registerEventListener(this);
    }

    @Override
    public String implementationVersion() {
        return BaritoneRuntimeVerifier.BARITONE_VERSION;
    }

    @Override
    public Set<String> capabilities() {
        return CAPABILITIES;
    }

    @Override
    public JsonObject snapshot() {
        synchronized (lock) {
            var result = new JsonObject();
            if (active == null) {
                result.addProperty("state", "idle");
                result.add("activeSkill", JsonNull.INSTANCE);
                result.add("goal", JsonNull.INSTANCE);
                return result;
            }

            var pathing = baritone.getPathingBehavior();
            if (pathing.isPathing()) {
                result.addProperty("state", "pathing");
            } else if (pathing.getInProgress().isPresent()) {
                result.addProperty("state", "planning");
            } else {
                result.addProperty("state", "paused");
            }
            result.addProperty("activeSkill", active.command.kind());
            result.add("goal", active.goal == null ? JsonNull.INSTANCE : active.goal.deepCopy());
            return result;
        }
    }

    @Override
    public void start(ActionCommand command, Completion completion) {
        Objects.requireNonNull(command, "command");
        Objects.requireNonNull(completion, "completion");
        synchronized (lock) {
            if (active != null) {
                throw new IllegalStateException("Baritone already has an active Mastermind action");
            }
            stopBaritone();
            switch (command.kind()) {
                case "skill.navigateTo" -> startNavigate(command, completion);
                case "skill.followPlayer" -> startFollow(command, completion);
                case "skill.gatherBlock" -> startGather(command, completion);
                case "skill.explore" -> startExplore(command, completion);
                case "skill.escapeDanger" -> startEscape(command, completion);
                case "skill.returnToKnownSafePoint" -> startReturnToSafePoint(command, completion);
                default -> throw new IllegalArgumentException("Unsupported Baritone skill " + command.kind());
            }
        }
    }

    @Override
    public void cancel(String reason) {
        synchronized (lock) {
            var previous = active;
            active = null;
            cleanup(previous);
        }
    }

    @Override
    public void onPathEvent(PathEvent event) {
        final Active current;
        synchronized (lock) {
            current = active;
        }
        if (current == null || current.mode != Mode.FIXED_GOAL) {
            return;
        }
        if (event == PathEvent.AT_GOAL) {
            succeed(current, "arrived");
        } else if (event == PathEvent.CALC_FAILED) {
            fail(current, "path-failed", "Baritone could not calculate a path to the typed goal");
        } else if (event == PathEvent.CANCELED) {
            fail(current, "path-cancelled", "Baritone stopped before reaching the typed goal");
        }
    }

    @Override
    public void onTick(TickEvent event) {
        if (event.getState() != EventState.POST || event.getType() != TickEvent.Type.IN) {
            return;
        }

        final Active current;
        synchronized (lock) {
            current = active;
        }
        if (current == null) {
            return;
        }

        switch (current.mode) {
            case FIXED_GOAL -> {
                var custom = baritone.getCustomGoalProcess();
                if (!custom.isActive()
                    && !baritone.getPathingBehavior().isPathing()
                    && baritone.getPathingBehavior().getInProgress().isEmpty()) {
                    fail(current, "path-stopped", "Baritone stopped before reaching the typed goal");
                }
            }
            case FOLLOW -> {
                if (!baritone.getFollowProcess().isActive()) {
                    fail(current, "follow-target-lost", "The selected player is no longer available to follow");
                }
            }
            case GATHER -> checkGather(current);
            case EXPLORE -> checkExplore(current);
        }
    }

    private void startNavigate(ActionCommand command, Completion completion) {
        var args = command.arguments();
        var target = new BlockPos(args.get("x").getAsInt(), args.get("y").getAsInt(), args.get("z").getAsInt());
        var tolerance = args.get("tolerance").getAsInt();
        startFixedGoal(command, completion, new GoalNear(target, tolerance), blockGoal(target));
    }

    private void startFollow(ActionCommand command, Completion completion) {
        var args = command.arguments();
        var targetUuid = UUID.fromString(args.get("playerUuid").getAsString());
        var distance = (int) Math.ceil(args.get("distance").getAsDouble());
        var world = baritone.getPlayerContext().world();
        if (world.getPlayerByUUID(targetUuid) == null) {
            throw new IllegalArgumentException("The selected player is not present in the Family world");
        }

        var settings = BaritoneAPI.getSettings();
        var previousRadius = settings.followRadius.value;
        settings.followRadius.value = distance;
        var goal = new JsonObject();
        goal.addProperty("kind", "follow-player");
        goal.addProperty("playerUuid", targetUuid.toString());
        active = new Active(command, completion, Mode.FOLLOW, goal, null, 0, null, 0,
            () -> settings.followRadius.value = previousRadius);
        try {
            baritone.getFollowProcess().follow(entity -> entity.getUUID().equals(targetUuid));
        } catch (RuntimeException error) {
            rollbackStart();
            throw error;
        }
    }

    private void startGather(ActionCommand command, Completion completion) {
        var args = command.arguments();
        var filter = new BlockOptionalMetaLookup(args.get("blockId").getAsString());
        if (filter.blocks().size() != 1) {
            throw new IllegalArgumentException("The requested block ID is not an exact registered block");
        }
        var requestedCount = args.get("count").getAsInt();
        var maxDistance = args.get("maxDistance").getAsInt();
        var context = baritone.getPlayerContext();
        var origin = context.playerFeet();
        var chunkRadius = Math.max(1, (maxDistance + 15) / 16);
        var candidates = BaritoneAPI.getProvider().getWorldScanner().scanChunkRadius(
            context, filter, 1_024, -1, chunkRadius
        );
        var maxDistanceSquared = (double) maxDistance * maxDistance;
        if (candidates.stream().noneMatch(position -> origin.distSqr(position) <= maxDistanceSquared)) {
            throw new IllegalArgumentException("No matching block is known inside the requested gather radius");
        }

        var targetCount = inventoryCount(filter) + requestedCount;
        var settings = BaritoneAPI.getSettings();
        var previousExploreForBlocks = settings.exploreForBlocks.value;
        var previousCachedScanCount = settings.maxCachedWorldScanCount.value;
        var previousExtendCache = settings.extendCacheOnThreshold.value;
        var previousDroppedItems = settings.mineScanDroppedItems.value;
        settings.exploreForBlocks.value = false;
        settings.maxCachedWorldScanCount.value = 0;
        settings.extendCacheOnThreshold.value = false;
        settings.mineScanDroppedItems.value = false;
        active = new Active(command, completion, Mode.GATHER, null, origin, maxDistance, filter, targetCount, () -> {
            settings.exploreForBlocks.value = previousExploreForBlocks;
            settings.maxCachedWorldScanCount.value = previousCachedScanCount;
            settings.extendCacheOnThreshold.value = previousExtendCache;
            settings.mineScanDroppedItems.value = previousDroppedItems;
        });
        try {
            baritone.getMineProcess().mine(targetCount, filter);
        } catch (RuntimeException error) {
            rollbackStart();
            throw error;
        }
    }

    private void startExplore(ActionCommand command, Completion completion) {
        var radius = command.arguments().get("radius").getAsInt();
        var origin = baritone.getPlayerContext().playerFeet();
        var settings = BaritoneAPI.getSettings();
        var previousDisableCompletion = settings.disableCompletionCheck.value;
        settings.disableCompletionCheck.value = true;
        var goal = new JsonObject();
        goal.addProperty("kind", "explore");
        goal.addProperty("radius", radius);
        active = new Active(command, completion, Mode.EXPLORE, goal, origin, radius, null, 0,
            () -> settings.disableCompletionCheck.value = previousDisableCompletion);
        try {
            baritone.getExploreProcess().explore(origin.getX(), origin.getZ());
        } catch (RuntimeException error) {
            rollbackStart();
            throw error;
        }
    }

    private void startEscape(ActionCommand command, Completion completion) {
        var origin = baritone.getPlayerContext().playerFeet();
        startFixedGoal(command, completion, new GoalRunAway(ESCAPE_DISTANCE, origin), null);
    }

    private void startReturnToSafePoint(ActionCommand command, Completion completion) {
        var safePointId = command.arguments().get("safePointId").getAsString();
        var worldData = baritone.getWorldProvider().getCurrentWorld();
        if (worldData == null) {
            throw new IllegalStateException("No Baritone world data is loaded");
        }
        var waypoint = worldData.getWaypoints().getAllWaypoints().stream()
            .filter(value -> safePointId.equalsIgnoreCase(value.getName()))
            .max(Comparator.comparingLong(value -> value.getCreationTimestamp()))
            .orElseThrow(() -> new IllegalArgumentException("The requested safe point does not exist"));
        var target = waypoint.getLocation();
        startFixedGoal(command, completion, new GoalNear(target, 2), blockGoal(target));
    }

    private void startFixedGoal(ActionCommand command, Completion completion, Goal target, JsonObject snapshotGoal) {
        active = new Active(command, completion, Mode.FIXED_GOAL, snapshotGoal, null, 0, null, 0, () -> { });
        try {
            baritone.getCustomGoalProcess().setGoalAndPath(target);
        } catch (RuntimeException error) {
            rollbackStart();
            throw error;
        }
    }

    private void checkGather(Active current) {
        var playerPosition = baritone.getPlayerContext().playerFeet();
        if (current.origin.distSqr(playerPosition) > (double) current.radius * current.radius) {
            fail(current, "gather-radius-exceeded", "Baritone reached the hard travel boundary for this gather action");
            return;
        }
        if (!baritone.getMineProcess().isActive()) {
            if (inventoryCount(current.gatherFilter) >= current.gatherTargetCount) {
                succeed(current, "gathered");
            } else {
                fail(current, "gather-incomplete", "Baritone exhausted known matching blocks inside the bounded gather action");
            }
        }
    }

    private void checkExplore(Active current) {
        var position = baritone.getPlayerContext().playerFeet();
        var dx = (long) position.getX() - current.origin.getX();
        var dz = (long) position.getZ() - current.origin.getZ();
        if (dx * dx + dz * dz >= (long) current.radius * current.radius) {
            succeed(current, "radius-reached");
        } else if (!baritone.getExploreProcess().isActive()) {
            fail(current, "explore-stopped", "Baritone stopped before reaching the requested exploration radius");
        }
    }

    private int inventoryCount(BlockOptionalMetaLookup filter) {
        return baritone.getPlayerContext().player().getInventory().getNonEquipmentItems().stream()
            .filter(filter::has)
            .mapToInt(stack -> stack.getCount())
            .sum();
    }

    private void succeed(Active expected, String resultCode) {
        var completion = finish(expected);
        if (completion != null) {
            completion.succeeded(resultCode);
        }
    }

    private void fail(Active expected, String errorCode, String message) {
        var completion = finish(expected);
        if (completion != null) {
            completion.failed(errorCode, message);
        }
    }

    private Completion finish(Active expected) {
        synchronized (lock) {
            if (active != expected) {
                return null;
            }
            active = null;
            cleanup(expected);
            return expected.completion;
        }
    }

    private void rollbackStart() {
        var previous = active;
        active = null;
        cleanup(previous);
    }

    private void stopBaritone() {
        try {
            baritone.getPathingBehavior().cancelEverything();
        } finally {
            try {
                baritone.getPathingBehavior().forceCancel();
            } finally {
                baritone.getInputOverrideHandler().clearAllKeys();
            }
        }
    }

    private void cleanup(Active previous) {
        try {
            stopBaritone();
        } catch (RuntimeException ignored) {
            // clearAllKeys ran in stopBaritone's finally chain. Cleanup must
            // still restore action-scoped settings and deliver a terminal.
        }
        try {
            restore(previous);
        } catch (RuntimeException ignored) {
            // A Baritone setting implementation must not strand the action.
        }
    }

    private static void restore(Active previous) {
        if (previous != null) {
            previous.restoreSettings.run();
        }
    }

    private static JsonObject blockGoal(BlockPos target) {
        var goal = new JsonObject();
        goal.addProperty("kind", "block");
        goal.addProperty("x", target.getX());
        goal.addProperty("y", target.getY());
        goal.addProperty("z", target.getZ());
        return goal;
    }
}

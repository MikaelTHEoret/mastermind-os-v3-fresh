package com.mastermind.minecraft.familyagent.client;

import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.action.ActionCommand;
import com.mastermind.minecraft.familyagent.action.ActionRegistry;
import com.mastermind.minecraft.familyagent.navigation.NavigationProvider;
import com.mastermind.minecraft.familyagent.navigation.NavigationUnavailableException;
import com.mastermind.minecraft.familyagent.protocol.ClientPayloads;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.arguments.EntityAnchorArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.protocol.game.ServerboundClientCommandPacket;
import net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket;
import net.minecraft.resources.Identifier;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.inventory.AbstractFurnaceMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.BiConsumer;

final class MinecraftActionController {
    private static final int TERMINAL_REPLAY_LIMIT = 128;

    private sealed interface RunningAction permits TimedMove, TimedLook, OneTickJump, WaterEscapeAction, PlacementAction, FurnaceAction, NavigationAction {
        ActionCommand command();

        void tick(long nowNanos);

        void cancel(String reason);
    }

    private final class PlacementAction implements RunningAction {
        private final ActionCommand command;
        private final BlockPos target;
        private final Identifier expectedBlock;
        private final long deadlineNanos;

        private PlacementAction(ActionCommand command, BlockPos target, Identifier expectedBlock, long nowNanos) {
            this.command = command;
            this.target = target;
            this.expectedBlock = expectedBlock;
            this.deadlineNanos = nowNanos + 2_000_000_000L;
        }

        @Override
        public ActionCommand command() {
            return command;
        }

        @Override
        public void tick(long nowNanos) {
            if (minecraft.level == null) {
                finishFailed(command.actionId(), "not-in-world", "The Family AI client is not in a world");
                return;
            }
            var actual = BuiltInRegistries.BLOCK.getKey(minecraft.level.getBlockState(target).getBlock());
            if (expectedBlock.equals(actual)) {
                finishSucceeded(command.actionId(), "placed");
            } else if (nowNanos >= deadlineNanos) {
                finishFailed(command.actionId(), "placement-not-confirmed", "The server did not confirm the requested block placement");
            }
        }

        @Override
        public void cancel(String reason) {
            // A placement is a single bounded interaction and holds no input state.
        }
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
                    args.get("x").getAsDouble() + 0.5D,
                    args.get("y").getAsDouble() + 0.5D,
                    args.get("z").getAsDouble() + 0.5D
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

    private final class WaterEscapeAction implements RunningAction {
        private final ActionCommand command;

        private WaterEscapeAction(ActionCommand command) {
            this.command = command;
            minecraft.options.keyJump.setDown(true);
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
            minecraft.options.keyJump.setDown(true);
            if (!player.isInWater() || player.getAirSupply() >= 280) {
                finishSucceeded(command.actionId(), "surfaced");
            }
        }

        @Override
        public void cancel(String reason) {
            minecraft.options.keyJump.setDown(false);
        }
    }

    private final class FurnaceAction implements RunningAction {
        private enum Stage { NAVIGATING, OPENING, WAITING_SCREEN, WAITING_LOAD, SMELTING, COLLECTING }

        private final ActionCommand command;
        private final BlockPos target;
        private final Identifier blockId;
        private final Identifier inputItemId;
        private final Identifier outputItemId;
        private final Identifier fuelItemId;
        private final int count;
        private final int fuelCount;
        private final int initialOutputCount;
        private Stage stage;
        private long stageDeadlineNanos;

        private FurnaceAction(ActionCommand command, BlockPos target) {
            this.command = command;
            this.target = target;
            var args = command.arguments();
            blockId = Identifier.parse(args.get("blockId").getAsString());
            inputItemId = Identifier.parse(args.get("inputItemId").getAsString());
            outputItemId = Identifier.parse(args.get("outputItemId").getAsString());
            fuelItemId = Identifier.parse(args.get("fuelItemId").getAsString());
            count = args.get("count").getAsInt();
            fuelCount = Math.max(1, (count + 7) / 8);
            initialOutputCount = inventoryCount(outputItemId);
        }

        private void start(long nowNanos) {
            var player = requirePlayer();
            if (player.getEyePosition().distanceToSqr(Vec3.atCenterOf(target)) <= 36.0D) {
                stage = Stage.OPENING;
                tick(nowNanos);
                return;
            }
            stage = Stage.NAVIGATING;
            var args = new JsonObject();
            args.addProperty("x", target.getX());
            args.addProperty("y", target.getY());
            args.addProperty("z", target.getZ());
            args.addProperty("tolerance", 2);
            var navigationCommand = new ActionCommand(command.actionId(), command.deadlineAt(), "skill.navigateTo", args);
            navigation.start(navigationCommand, new NavigationProvider.Completion() {
                @Override
                public void succeeded(String resultCode) {
                    minecraft.execute(() -> {
                        if (running == FurnaceAction.this) stage = Stage.OPENING;
                    });
                }

                @Override
                public void failed(String errorCode, String message) {
                    minecraft.execute(() -> finishFailed(command.actionId(), errorCode, message));
                }
            });
        }

        @Override
        public ActionCommand command() {
            return command;
        }

        @Override
        public void tick(long nowNanos) {
            switch (stage) {
                case NAVIGATING -> navigation.tick();
                case OPENING -> open(nowNanos);
                case WAITING_SCREEN -> waitForScreen(nowNanos);
                case WAITING_LOAD -> waitForLoad(nowNanos);
                case SMELTING -> waitForResult();
                case COLLECTING -> verifyCollected(nowNanos);
            }
        }

        private void open(long nowNanos) {
            var player = requirePlayer();
            var level = minecraft.level;
            var gameMode = minecraft.gameMode;
            if (level == null || gameMode == null) {
                finishFailed(command.actionId(), "not-in-world", "The Family AI client has no active world");
                return;
            }
            var actual = BuiltInRegistries.BLOCK.getKey(level.getBlockState(target).getBlock());
            if (!blockId.equals(actual)) {
                finishFailed(command.actionId(), "target-mismatch", "The selected furnace changed before it could be opened");
                return;
            }
            if (player.getEyePosition().distanceToSqr(Vec3.atCenterOf(target)) > 36.0D) {
                finishFailed(command.actionId(), "target-out-of-reach", "Baritone stopped outside furnace reach");
                return;
            }
            var hit = new BlockHitResult(Vec3.atCenterOf(target), Direction.UP, target, false);
            var result = gameMode.useItemOn(player, InteractionHand.MAIN_HAND, hit);
            if (!result.consumesAction()) {
                finishFailed(command.actionId(), "furnace-open-rejected", "Minecraft rejected the furnace interaction");
                return;
            }
            player.swing(InteractionHand.MAIN_HAND);
            stage = Stage.WAITING_SCREEN;
            stageDeadlineNanos = nowNanos + 3_000_000_000L;
        }

        private void waitForScreen(long nowNanos) {
            var player = requirePlayer();
            if (player.containerMenu instanceof AbstractFurnaceMenu menu) {
                if (!menu.getSlot(0).getItem().isEmpty() || !menu.getSlot(2).getItem().isEmpty()) {
                    finishFailed(command.actionId(), "furnace-not-empty", "The selected furnace already contains an input or completed result");
                    return;
                }
                var fuel = menu.getSlot(1).getItem();
                if (!fuel.isEmpty() && !fuelItemId.equals(itemId(fuel))) {
                    finishFailed(command.actionId(), "furnace-fuel-mismatch", "The selected furnace contains a different fuel");
                    return;
                }
                if (!moveExact(menu, inputItemId, 0, count) || !moveExact(menu, fuelItemId, 1, fuelCount)) {
                    finishFailed(command.actionId(), "smelt-items-unavailable", "The requested food or enough fuel is not available in the inventory");
                    return;
                }
                stage = Stage.WAITING_LOAD;
                stageDeadlineNanos = nowNanos + 3_000_000_000L;
                return;
            }
            if (nowNanos >= stageDeadlineNanos) {
                finishFailed(command.actionId(), "furnace-screen-timeout", "The furnace screen did not open in time");
            }
        }

        private void waitForLoad(long nowNanos) {
            var menu = furnaceMenu();
            if (menu == null) return;
            var input = menu.getSlot(0).getItem();
            var fuel = menu.getSlot(1).getItem();
            var fuelConfirmed = menu.isLit()
                || (!fuel.isEmpty() && fuelItemId.equals(itemId(fuel)) && fuel.getCount() >= fuelCount);
            if (!input.isEmpty() && inputItemId.equals(itemId(input)) && input.getCount() >= count
                && fuelConfirmed) {
                stage = Stage.SMELTING;
                return;
            }
            if (nowNanos >= stageDeadlineNanos) {
                finishFailed(command.actionId(), "furnace-load-not-confirmed", "The server did not confirm the furnace input and fuel transfer");
            }
        }

        private void waitForResult() {
            var menu = furnaceMenu();
            if (menu == null) return;
            var result = menu.getSlot(2).getItem();
            if (!result.isEmpty() && outputItemId.equals(itemId(result)) && result.getCount() >= count) {
                click(menu, 2, 0, ContainerInput.QUICK_MOVE);
                stage = Stage.COLLECTING;
                stageDeadlineNanos = System.nanoTime() + 3_000_000_000L;
            }
        }

        private void verifyCollected(long nowNanos) {
            if (inventoryCount(outputItemId) >= initialOutputCount + count) {
                closeFurnaceScreen();
                finishSucceeded(command.actionId(), "smelted-and-collected");
                return;
            }
            if (nowNanos >= stageDeadlineNanos) {
                finishFailed(command.actionId(), "smelt-result-not-collected", "The cooked result was not confirmed in the companion inventory");
            }
        }

        private AbstractFurnaceMenu furnaceMenu() {
            var player = requirePlayer();
            if (player.containerMenu instanceof AbstractFurnaceMenu menu) return menu;
            finishFailed(command.actionId(), "furnace-screen-closed", "The furnace screen closed before cooking completed");
            return null;
        }

        private boolean moveExact(AbstractFurnaceMenu menu, Identifier expected, int targetSlot, int requested) {
            var targetStack = menu.getSlot(targetSlot).getItem();
            if (!targetStack.isEmpty() && !expected.equals(itemId(targetStack))) return false;
            for (var sourceSlot = 3; sourceSlot < menu.slots.size(); sourceSlot += 1) {
                var source = menu.getSlot(sourceSlot).getItem();
                if (source.isEmpty() || !expected.equals(itemId(source)) || source.getCount() < requested) continue;
                click(menu, sourceSlot, 0, ContainerInput.PICKUP);
                for (var moved = 0; moved < requested; moved += 1) click(menu, targetSlot, 1, ContainerInput.PICKUP);
                if (!menu.getCarried().isEmpty()) click(menu, sourceSlot, 0, ContainerInput.PICKUP);
                return true;
            }
            return false;
        }

        private void click(AbstractFurnaceMenu menu, int slot, int button, ContainerInput type) {
            var gameMode = minecraft.gameMode;
            if (gameMode == null) throw new IllegalStateException("The Family AI client has no active game mode");
            gameMode.handleContainerInput(menu.containerId, slot, button, type, requirePlayer());
        }

        @Override
        public void cancel(String reason) {
            try { navigation.cancel(reason); } catch (RuntimeException ignored) { }
            closeFurnaceScreen();
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
                case "direct.selectSlot" -> selectSlot(command);
                case "direct.use" -> use(command);
                case "direct.interactBlock" -> interactBlock(command);
                case "direct.interactEntity" -> interactEntity(command);
                case "direct.placeBlock" -> placeBlock(command, nowNanos);
                case "direct.placeNearbyBlock" -> placeNearbyBlock(command, nowNanos);
                case "direct.dropItem" -> dropItem(command);
                case "direct.dropItemById" -> dropItemById(command);
                case "direct.selectItem" -> selectItem(command);
                case "direct.swingHand" -> swingHand(command);
                case "skill.smelt" -> startSmelt(command, nowNanos);
                case "skill.escapeDanger" -> startEscape(command);
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

    private void selectSlot(ActionCommand command) {
        var slot = command.arguments().get("slot").getAsInt();
        selectHotbarSlot(requirePlayer(), slot);
        finishSucceeded(command.actionId(), "selected");
    }

    private void selectItem(ActionCommand command) {
        var player = requirePlayer();
        var expectedItem = Identifier.parse(command.arguments().get("itemId").getAsString());
        for (var slot = 0; slot < 9; slot += 1) {
            var stack = player.getInventory().getItem(slot);
            if (!stack.isEmpty() && expectedItem.equals(BuiltInRegistries.ITEM.getKey(stack.getItem()))) {
                selectHotbarSlot(player, slot);
                finishSucceeded(command.actionId(), "selected");
                return;
            }
        }
        finishFailed(command.actionId(), "item-not-in-hotbar", "The requested item is not available in the companion hotbar");
    }

    private void swingHand(ActionCommand command) {
        var player = requirePlayer();
        var hand = command.arguments().get("hand").getAsString().equals("off")
            ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND;
        player.swing(hand);
        finishSucceeded(command.actionId(), "swung");
    }

    private void use(ActionCommand command) {
        var player = requirePlayer();
        var gameMode = minecraft.gameMode;
        if (gameMode == null) {
            finishFailed(command.actionId(), "not-in-world", "The Family AI client has no active game mode");
            return;
        }
        var hand = command.arguments().get("hand").getAsString().equals("off")
            ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND;
        final InteractionResult result;
        if (minecraft.hitResult instanceof BlockHitResult blockTarget
            && blockTarget.getType() == HitResult.Type.BLOCK) {
            result = gameMode.useItemOn(player, hand, blockTarget);
        } else if (minecraft.hitResult instanceof EntityHitResult entityTarget) {
            result = gameMode.interact(player, entityTarget.getEntity(), entityTarget, hand);
        } else {
            result = gameMode.useItem(player, hand);
        }
        if (!result.consumesAction()) {
            finishFailed(command.actionId(), "nothing-used", "The selected hand and crosshair target did not accept an interaction");
            return;
        }
        player.swing(hand);
        finishSucceeded(command.actionId(), "used");
    }

    private void interactBlock(ActionCommand command) {
        var player = requirePlayer();
        var level = minecraft.level;
        var gameMode = minecraft.gameMode;
        if (level == null || gameMode == null) {
            finishFailed(command.actionId(), "not-in-world", "The Family AI client has no active world");
            return;
        }
        var args = command.arguments();
        var target = new BlockPos(args.get("x").getAsInt(), args.get("y").getAsInt(), args.get("z").getAsInt());
        var expected = Identifier.parse(args.get("blockId").getAsString());
        var actual = BuiltInRegistries.BLOCK.getKey(level.getBlockState(target).getBlock());
        if (!expected.equals(actual)) {
            finishFailed(command.actionId(), "target-mismatch", "The observed block changed before interaction");
            return;
        }
        if (player.getEyePosition().distanceToSqr(Vec3.atCenterOf(target)) > 36.0D) {
            finishFailed(command.actionId(), "target-out-of-reach", "The requested block is outside normal player reach");
            return;
        }
        var hand = args.get("hand").getAsString().equals("off") ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND;
        var hit = new BlockHitResult(Vec3.atCenterOf(target), Direction.UP, target, false);
        var result = gameMode.useItemOn(player, hand, hit);
        if (!result.consumesAction()) {
            finishFailed(command.actionId(), "nothing-used", "The requested block did not accept an interaction");
            return;
        }
        player.swing(hand);
        finishSucceeded(command.actionId(), "interacted-block");
    }

    private void interactEntity(ActionCommand command) {
        var player = requirePlayer();
        var level = minecraft.level;
        var gameMode = minecraft.gameMode;
        if (level == null || gameMode == null) {
            finishFailed(command.actionId(), "not-in-world", "The Family AI client has no active world");
            return;
        }
        var args = command.arguments();
        var targetId = UUID.fromString(args.get("entityUuid").getAsString());
        var expectedType = Identifier.parse(args.get("typeId").getAsString());
        var target = level.getEntities(player, player.getBoundingBox().inflate(6.0D)).stream()
            .filter(entity -> entity.getUUID().equals(targetId))
            .findFirst().orElse(null);
        if (target == null || !target.isAlive()) {
            finishFailed(command.actionId(), "target-unavailable", "The requested entity is no longer nearby");
            return;
        }
        if (!expectedType.equals(BuiltInRegistries.ENTITY_TYPE.getKey(target.getType()))) {
            finishFailed(command.actionId(), "target-mismatch", "The observed entity changed before interaction");
            return;
        }
        if (player.distanceToSqr(target) > 36.0D) {
            finishFailed(command.actionId(), "target-out-of-reach", "The requested entity is outside normal player reach");
            return;
        }
        if (!player.hasLineOfSight(target)) {
            finishFailed(command.actionId(), "target-obscured", "The requested entity is not visible from the companion position");
            return;
        }
        var hand = args.get("hand").getAsString().equals("off") ? InteractionHand.OFF_HAND : InteractionHand.MAIN_HAND;
        var result = gameMode.interact(player, target, new EntityHitResult(target), hand);
        if (!result.consumesAction()) {
            finishFailed(command.actionId(), "nothing-used", "The requested entity did not accept an interaction");
            return;
        }
        player.swing(hand);
        finishSucceeded(command.actionId(), "interacted-entity");
    }

    private void placeBlock(ActionCommand command, long nowNanos) {
        var args = command.arguments();
        var expectedBlock = Identifier.parse(args.get("blockId").getAsString());
        var target = new BlockPos(args.get("x").getAsInt(), args.get("y").getAsInt(), args.get("z").getAsInt());
        startPlacementAt(command, target, expectedBlock, nowNanos);
    }

    private void placeNearbyBlock(ActionCommand command, long nowNanos) {
        var player = requirePlayer();
        var level = minecraft.level;
        if (level == null) {
            finishFailed(command.actionId(), "not-in-world", "The Family AI client has no active world");
            return;
        }
        var expectedBlock = Identifier.parse(command.arguments().get("blockId").getAsString());
        var base = player.blockPosition();
        int[][] offsets = {
            {0, 0, -1}, {1, 0, 0}, {0, 0, 1}, {-1, 0, 0},
            {1, 0, -1}, {1, 0, 1}, {-1, 0, 1}, {-1, 0, -1}
        };
        for (var offset : offsets) {
            var target = new BlockPos(base.getX() + offset[0], base.getY(), base.getZ() + offset[2]);
            var support = target.below();
            if (level.getBlockState(target).canBeReplaced()
                && !level.getBlockState(support).isAir()
                && level.getBlockState(support).isFaceSturdy(level, support, Direction.UP)) {
                startPlacementAt(command, target, expectedBlock, nowNanos);
                return;
            }
        }
        finishFailed(command.actionId(), "no-nearby-placement", "No nearby ground position can safely accept the requested block");
    }

    private void startPlacementAt(ActionCommand command, BlockPos target, Identifier expectedBlock, long nowNanos) {
        var player = requirePlayer();
        var level = minecraft.level;
        var gameMode = minecraft.gameMode;
        if (level == null || gameMode == null) {
            finishFailed(command.actionId(), "not-in-world", "The Family AI client has no active world");
            return;
        }
        if (!level.getBlockState(target).canBeReplaced()) {
            finishFailed(command.actionId(), "target-occupied", "The requested placement position is not replaceable");
            return;
        }
        var targetCenter = Vec3.atCenterOf(target);
        if (player.getEyePosition().distanceToSqr(targetCenter) > 36.0) {
            finishFailed(command.actionId(), "target-out-of-reach", "The requested placement position is outside normal player reach");
            return;
        }
        var slot = findHotbarBlock(player, expectedBlock);
        if (slot < 0) {
            finishFailed(command.actionId(), "block-not-in-hotbar", "The requested block is not available in the companion hotbar");
            return;
        }

        BlockHitResult hit = null;
        for (var direction : Direction.values()) {
            var support = target.relative(direction);
            var clickedFace = direction.getOpposite();
            var supportState = level.getBlockState(support);
            if (!supportState.isAir() && supportState.isFaceSturdy(level, support, clickedFace)) {
                var location = Vec3.atCenterOf(support).add(
                    clickedFace.getStepX() * 0.5,
                    clickedFace.getStepY() * 0.5,
                    clickedFace.getStepZ() * 0.5
                );
                hit = new BlockHitResult(location, clickedFace, support, false);
                break;
            }
        }
        if (hit == null) {
            finishFailed(command.actionId(), "no-placement-support", "No solid adjacent face can support the requested block");
            return;
        }

        selectHotbarSlot(player, slot);
        var result = gameMode.useItemOn(player, InteractionHand.MAIN_HAND, hit);
        if (!result.consumesAction()) {
            finishFailed(command.actionId(), "placement-rejected", "Minecraft rejected the bounded block placement interaction");
            return;
        }
        player.swing(InteractionHand.MAIN_HAND);
        running = new PlacementAction(command, target, expectedBlock, nowNanos);
    }

    private void dropItem(ActionCommand command) {
        var player = requirePlayer();
        if (player.getInventory().getSelectedItem().isEmpty()) {
            finishFailed(command.actionId(), "empty-hand", "The companion has no selected item to drop");
            return;
        }
        if (!player.drop(command.arguments().get("all").getAsBoolean())) {
            finishFailed(command.actionId(), "drop-rejected", "Minecraft rejected the held-item drop");
            return;
        }
        finishSucceeded(command.actionId(), "dropped");
    }

    private void dropItemById(ActionCommand command) {
        var player = requirePlayer();
        var expectedItem = Identifier.parse(command.arguments().get("itemId").getAsString());
        for (var slot = 0; slot < 9; slot += 1) {
            var stack = player.getInventory().getItem(slot);
            if (!stack.isEmpty() && expectedItem.equals(BuiltInRegistries.ITEM.getKey(stack.getItem()))) {
                selectHotbarSlot(player, slot);
                if (!player.drop(command.arguments().get("all").getAsBoolean())) {
                    finishFailed(command.actionId(), "drop-rejected", "Minecraft rejected the requested item drop");
                    return;
                }
                finishSucceeded(command.actionId(), "dropped");
                return;
            }
        }
        finishFailed(command.actionId(), "item-not-in-hotbar", "The requested item is not available in the companion hotbar");
    }

    private int findHotbarBlock(net.minecraft.client.player.LocalPlayer player, Identifier blockId) {
        for (var slot = 0; slot < 9; slot += 1) {
            ItemStack stack = player.getInventory().getItem(slot);
            if (stack.isEmpty() || !(stack.getItem() instanceof BlockItem blockItem)) {
                continue;
            }
            if (blockId.equals(BuiltInRegistries.BLOCK.getKey(blockItem.getBlock()))) {
                return slot;
            }
        }
        return -1;
    }

    private void selectHotbarSlot(net.minecraft.client.player.LocalPlayer player, int slot) {
        player.getInventory().setSelectedSlot(slot);
        requireConnection().send(new ServerboundSetCarriedItemPacket(slot));
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

    private void startEscape(ActionCommand command) {
        var player = requirePlayer();
        if (player.isInWater() && player.getAirSupply() < 280) {
            running = new WaterEscapeAction(command);
            return;
        }
        startNavigation(command);
    }

    private void startSmelt(ActionCommand command, long nowNanos) {
        var player = requirePlayer();
        var level = minecraft.level;
        if (level == null) {
            finishFailed(command.actionId(), "not-in-world", "The Family AI client has no active world");
            return;
        }
        var args = command.arguments();
        var expectedBlock = Identifier.parse(args.get("blockId").getAsString());
        var radius = args.get("maxDistance").getAsInt();
        var origin = player.blockPosition();
        BlockPos nearest = null;
        var nearestDistance = Double.MAX_VALUE;
        for (var x = -radius; x <= radius; x += 1) {
            for (var y = -radius; y <= radius; y += 1) {
                for (var z = -radius; z <= radius; z += 1) {
                    var candidate = origin.offset(x, y, z);
                    var distance = origin.distSqr(candidate);
                    if (distance > (double) radius * radius || distance >= nearestDistance) continue;
                    if (expectedBlock.equals(BuiltInRegistries.BLOCK.getKey(level.getBlockState(candidate).getBlock()))) {
                        nearest = candidate.immutable();
                        nearestDistance = distance;
                    }
                }
            }
        }
        if (nearest == null) {
            finishFailed(command.actionId(), "furnace-not-found", "No matching furnace is loaded inside the bounded search radius");
            return;
        }
        var action = new FurnaceAction(command, nearest);
        running = action;
        action.start(nowNanos);
    }

    private int inventoryCount(Identifier expectedItem) {
        var player = requirePlayer();
        return player.getInventory().getNonEquipmentItems().stream()
            .filter(stack -> !stack.isEmpty() && expectedItem.equals(itemId(stack)))
            .mapToInt(ItemStack::getCount)
            .sum();
    }

    private Identifier itemId(ItemStack stack) {
        return BuiltInRegistries.ITEM.getKey(stack.getItem());
    }

    private void closeFurnaceScreen() {
        var player = minecraft.player;
        if (player != null && player.containerMenu instanceof AbstractFurnaceMenu) player.closeContainer();
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

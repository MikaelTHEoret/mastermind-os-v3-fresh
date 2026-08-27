package com.mastermind.minecraft.familyagent.client;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.action.ActionRegistry;
import com.mastermind.minecraft.familyagent.config.FamilyServerAddressPolicy;
import com.mastermind.minecraft.familyagent.navigation.NavigationProvider;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.animal.Animal;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.TreeMap;
import java.util.UUID;

final class MinecraftSnapshotCollector {
    private MinecraftSnapshotCollector() {
    }

    static String phase(Minecraft minecraft) {
        if (minecraft.player != null && minecraft.level != null) {
            return "in-world";
        }
        if (minecraft.getConnection() != null) {
            return "connecting";
        }
        return "main-menu";
    }

    static JsonObject snapshot(Minecraft minecraft, NavigationProvider navigation, ActionRegistry registry,
                               long clientTick, boolean killSwitch, int familyServerPort, boolean includeInventory,
                               boolean includeAwareness) {
        var payload = new JsonObject();
        payload.addProperty("snapshotId", UUID.randomUUID().toString());
        payload.addProperty("clientTick", clientTick);
        payload.addProperty("phase", phase(minecraft));
        if (isFamilyServer(minecraft, familyServerPort)) {
            payload.addProperty("serverAlias", "family-server");
        } else {
            payload.add("serverAlias", JsonNull.INSTANCE);
        }
        addPlayer(payload, minecraft);
        addWorld(payload, minecraft);
        if (includeInventory) {
            addInventory(payload, minecraft);
        }
        if (includeAwareness) {
            addAwareness(payload, minecraft);
        }
        payload.add("baritone", navigation.snapshot());
        var active = registry.active();
        if (active.isPresent()) {
            var action = new JsonObject();
            action.addProperty("actionId", active.orElseThrow().actionId().toString());
            action.addProperty("kind", active.orElseThrow().kind());
            action.addProperty("status", "started");
            payload.add("activeAction", action);
        } else {
            payload.add("activeAction", JsonNull.INSTANCE);
        }
        var safety = new JsonObject();
        safety.addProperty("killSwitch", killSwitch);
        payload.add("safety", safety);
        return payload;
    }

    private static void addInventory(JsonObject payload, Minecraft minecraft) {
        var player = minecraft.player;
        if (player == null || minecraft.level == null) {
            payload.add("inventory", JsonNull.INSTANCE);
            return;
        }
        var totals = new TreeMap<String, Integer>();
        player.getInventory().getNonEquipmentItems().stream()
            .filter(stack -> !stack.isEmpty())
            .forEach(stack -> totals.merge(
                BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(),
                stack.getCount(),
                (left, right) -> Math.min(4_096, left + right)
            ));
        var items = new com.google.gson.JsonArray();
        totals.forEach((itemId, count) -> {
            var item = new JsonObject();
            item.addProperty("itemId", itemId);
            item.addProperty("count", count);
            items.add(item);
        });
        var inventory = new JsonObject();
        inventory.add("items", items);
        var hotbar = new com.google.gson.JsonArray();
        for (var slot = 0; slot < 9; slot += 1) {
            var stack = player.getInventory().getItem(slot);
            if (stack.isEmpty()) continue;
            var entry = new JsonObject();
            entry.addProperty("slot", slot);
            entry.addProperty("itemId", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
            entry.addProperty("count", Math.min(64, stack.getCount()));
            hotbar.add(entry);
        }
        inventory.add("hotbar", hotbar);
        inventory.addProperty("selectedSlot", player.getInventory().getSelectedSlot());
        payload.add("inventory", inventory);
    }

    private static void addAwareness(JsonObject payload, Minecraft minecraft) {
        var player = minecraft.player;
        var level = minecraft.level;
        if (player == null || level == null) {
            payload.add("awareness", JsonNull.INSTANCE);
            return;
        }
        final int radius = 8;
        var base = player.blockPosition();
        var observations = new TreeMap<String, LocalBlock>();
        for (var x = base.getX() - radius; x <= base.getX() + radius; x += 1) {
            for (var y = base.getY() - 4; y <= base.getY() + 4; y += 1) {
                for (var z = base.getZ() - radius; z <= base.getZ() + radius; z += 1) {
                    var pos = new BlockPos(x, y, z);
                    var state = level.getBlockState(pos);
                    if (state.isAir()) continue;
                    var blockId = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
                    var dx = x - base.getX();
                    var dy = y - base.getY();
                    var dz = z - base.getZ();
                    var distanceSq = dx * dx + dy * dy + dz * dz;
                    var current = observations.get(blockId);
                    observations.put(blockId, current == null
                        ? new LocalBlock(blockId, x, y, z, distanceSq, 1)
                        : current.withObservation(x, y, z, distanceSq));
                }
            }
        }
        var blocks = new com.google.gson.JsonArray();
        observations.values().stream()
            .sorted(Comparator.comparingInt(LocalBlock::distanceSq).thenComparing(LocalBlock::blockId))
            .limit(64)
            .forEach(observation -> blocks.add(observation.json()));

        var nearby = new ArrayList<NearbyPlayer>();
        for (var other : level.players()) {
            if (other == player) continue;
            var distanceSq = player.distanceToSqr(other);
            if (distanceSq > 4_096.0D) continue;
            nearby.add(new NearbyPlayer(
                other.getUUID().toString(), other.getName().getString(),
                other.getX(), other.getY(), other.getZ(), distanceSq,
                player.hasLineOfSight(other),
                other.getMainHandItem().isEmpty() ? null
                    : BuiltInRegistries.ITEM.getKey(other.getMainHandItem().getItem()).toString()
            ));
        }
        var players = new com.google.gson.JsonArray();
        nearby.stream().sorted(Comparator.comparingDouble(NearbyPlayer::distanceSq)).limit(16)
            .forEach(observation -> players.add(observation.json()));

        var entities = new ArrayList<NearbyEntity>();
        for (Entity entity : level.getEntities(player, player.getBoundingBox().inflate(32.0D))) {
            if (entity == player || entity instanceof net.minecraft.world.entity.player.Player) continue;
            var distanceSq = player.distanceToSqr(entity);
            if (distanceSq > 1_024.0D) continue;
            var typeId = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
            var category = entity instanceof Enemy ? "hostile"
                : entity instanceof Animal ? "passive"
                : entity instanceof ItemEntity ? "item"
                : "other";
            var itemId = entity instanceof ItemEntity item && !item.getItem().isEmpty()
                ? BuiltInRegistries.ITEM.getKey(item.getItem().getItem()).toString()
                : null;
            entities.add(new NearbyEntity(
                entity.getUUID().toString(), typeId, entity.getName().getString(), category,
                entity.getX(), entity.getY(), entity.getZ(), distanceSq,
                player.hasLineOfSight(entity), entity.isAlive(), itemId
            ));
        }
        var entityValues = new com.google.gson.JsonArray();
        entities.stream().sorted(Comparator.comparingDouble(NearbyEntity::distanceSq)).limit(32)
            .forEach(observation -> entityValues.add(observation.json()));

        var awareness = new JsonObject();
        awareness.addProperty("radius", radius);
        awareness.add("blocks", blocks);
        awareness.add("players", players);
        awareness.add("entities", entityValues);
        awareness.add("crosshairTarget", crosshairTarget(minecraft, player));
        payload.add("awareness", awareness);
    }

    private static JsonObject crosshairTarget(Minecraft minecraft, net.minecraft.world.entity.player.Player player) {
        var value = new JsonObject();
        var hit = minecraft.hitResult;
        if (hit instanceof BlockHitResult blockHit) {
            var pos = blockHit.getBlockPos();
            var state = minecraft.level.getBlockState(pos);
            if (state.isAir()) {
                value.addProperty("kind", "miss");
                return value;
            }
            value.addProperty("kind", "block");
            value.addProperty("blockId", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
            value.addProperty("x", pos.getX());
            value.addProperty("y", pos.getY());
            value.addProperty("z", pos.getZ());
            value.addProperty("distanceSq", Math.min(1_024.0D, player.distanceToSqr(Vec3.atCenterOf(pos))));
        } else if (hit instanceof EntityHitResult entityHit) {
            var entity = entityHit.getEntity();
            value.addProperty("kind", "entity");
            value.addProperty("entityUuid", entity.getUUID().toString());
            value.addProperty("typeId", BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString());
            value.addProperty("x", entity.getX());
            value.addProperty("y", entity.getY());
            value.addProperty("z", entity.getZ());
            value.addProperty("distanceSq", Math.min(1_024.0D, player.distanceToSqr(entity)));
        } else {
            value.addProperty("kind", "miss");
        }
        return value;
    }

    private record LocalBlock(String blockId, int x, int y, int z, int distanceSq, int count) {
        LocalBlock withObservation(int nextX, int nextY, int nextZ, int nextDistanceSq) {
            if (nextDistanceSq < distanceSq) return new LocalBlock(blockId, nextX, nextY, nextZ, nextDistanceSq, Math.min(4_096, count + 1));
            return new LocalBlock(blockId, x, y, z, distanceSq, Math.min(4_096, count + 1));
        }

        JsonObject json() {
            var value = new JsonObject();
            value.addProperty("blockId", blockId);
            value.addProperty("x", x);
            value.addProperty("y", y);
            value.addProperty("z", z);
            value.addProperty("distanceSq", distanceSq);
            value.addProperty("count", count);
            return value;
        }
    }

    private record NearbyPlayer(String minecraftUuid, String displayName, double x, double y, double z, double distanceSq,
                                boolean visible, String heldItemId) {
        JsonObject json() {
            var value = new JsonObject();
            value.addProperty("minecraftUuid", minecraftUuid);
            value.addProperty("displayName", displayName.substring(0, Math.min(64, displayName.length())));
            value.addProperty("x", x);
            value.addProperty("y", y);
            value.addProperty("z", z);
            value.addProperty("distanceSq", distanceSq);
            value.addProperty("visible", visible);
            if (heldItemId == null) value.add("heldItemId", JsonNull.INSTANCE);
            else value.addProperty("heldItemId", heldItemId);
            return value;
        }
    }

    private record NearbyEntity(String entityUuid, String typeId, String displayName, String category,
                                double x, double y, double z, double distanceSq,
                                boolean visible, boolean alive, String itemId) {
        JsonObject json() {
            var value = new JsonObject();
            value.addProperty("entityUuid", entityUuid);
            value.addProperty("typeId", typeId);
            value.addProperty("displayName", displayName.substring(0, Math.min(64, displayName.length())));
            value.addProperty("category", category);
            value.addProperty("x", x);
            value.addProperty("y", y);
            value.addProperty("z", z);
            value.addProperty("distanceSq", distanceSq);
            value.addProperty("visible", visible);
            value.addProperty("alive", alive);
            if (itemId == null) value.add("itemId", JsonNull.INSTANCE);
            else value.addProperty("itemId", itemId);
            return value;
        }
    }

    static boolean isFamilyServer(Minecraft minecraft, int familyServerPort) {
        if (minecraft.player == null || minecraft.level == null || minecraft.getConnection() == null) {
            return false;
        }
        var server = minecraft.getCurrentServer();
        if (server == null) {
            return false;
        }
        return FamilyServerAddressPolicy.isTrusted(server.ip, familyServerPort);
    }

    private static void addPlayer(JsonObject payload, Minecraft minecraft) {
        var player = minecraft.player;
        if (player == null || minecraft.level == null) {
            payload.add("player", JsonNull.INSTANCE);
            return;
        }
        var value = new JsonObject();
        value.add("position", vector(player.position()));
        value.add("velocity", vector(clampVelocity(player.getDeltaMovement())));
        value.addProperty("yaw", wrapDegrees(player.getYRot()));
        value.addProperty("pitch", Math.max(-90.0F, Math.min(90.0F, player.getXRot())));
        var maxHealth = Math.min(2_048.0F, Math.max(1.0F, player.getMaxHealth()));
        value.addProperty("health", Math.max(0.0F, Math.min(maxHealth, player.getHealth())));
        value.addProperty("maxHealth", maxHealth);
        value.addProperty("hunger", Math.max(0, Math.min(20, player.getFoodData().getFoodLevel())));
        value.addProperty("armor", Math.max(0, Math.min(30, player.getArmorValue())));
        value.addProperty("air", Math.max(0, Math.min(300, player.getAirSupply())));
        value.addProperty("inWater", player.isInWater());
        value.addProperty("onFire", player.isOnFire());
        value.addProperty("dimension", minecraft.level.dimension().identifier().toString());
        payload.add("player", value);
    }

    private static void addWorld(JsonObject payload, Minecraft minecraft) {
        var level = minecraft.level;
        if (level == null) {
            payload.add("world", JsonNull.INSTANCE);
            return;
        }
        var value = new JsonObject();
        value.addProperty("timeOfDay", Math.floorMod(level.getOverworldClockTime(), 24_000L));
        value.addProperty("weather", level.isThundering() ? "thunder" : level.isRaining() ? "rain" : "clear");
        payload.add("world", value);
    }

    private static JsonObject vector(Vec3 vector) {
        var value = new JsonObject();
        value.addProperty("x", vector.x);
        value.addProperty("y", vector.y);
        value.addProperty("z", vector.z);
        return value;
    }

    private static Vec3 clampVelocity(Vec3 vector) {
        return new Vec3(clamp(vector.x, 1_024), clamp(vector.y, 1_024), clamp(vector.z, 1_024));
    }

    private static double clamp(double value, double absoluteLimit) {
        return Math.max(-absoluteLimit, Math.min(absoluteLimit, value));
    }

    private static float wrapDegrees(float value) {
        var wrapped = value % 360.0F;
        if (wrapped >= 180.0F) wrapped -= 360.0F;
        if (wrapped < -180.0F) wrapped += 360.0F;
        return wrapped;
    }
}

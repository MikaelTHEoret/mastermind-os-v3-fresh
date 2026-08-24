package com.mastermind.minecraft.familyagent.protocol;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.action.ActionCommand;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static com.mastermind.minecraft.familyagent.protocol.JsonFields.*;

public final class BridgeCodec {
    private static final Gson GSON = new GsonBuilder().serializeNulls().disableHtmlEscaping().create();
    private static final Set<String> ENVELOPE_FIELDS = Set.of(
        "protocol", "version", "messageId", "sessionId", "seq", "sentAt", "source", "type", "payload"
    );
    private static final Set<String> CANCEL_REASONS = Set.of(
        "operator", "deadline", "shutdown", "superseded",
        "player-request", "player-replacement-request", "survival-emergency"
    );
    private static final Set<String> CLIENT_CANCEL_REASONS = Set.of(
        "operator", "deadline", "shutdown", "superseded", "player-request", "player-replacement-request",
        "survival-emergency", "connection-lost", "kill-switch", "client-shutdown"
    );
    private static final Set<String> PHASES = Set.of("main-menu", "connecting", "in-world", "disconnected");
    private static final Set<String> BARITONE_STATES = Set.of("idle", "planning", "pathing", "paused", "failed");

    public ControlMessage.Hello decodeInitialHello(String text) {
        var message = decodeControlMessage(text, null, 0);
        if (!(message instanceof ControlMessage.Hello hello) || hello.envelope().sequence() != 1) {
            throw new ProtocolException("SESSION_NOT_ESTABLISHED", "The first control frame must be control.hello with sequence 1", 4409);
        }
        return hello;
    }

    public ControlMessage decodeControl(String text, UUID expectedSessionId, long previousSequence) {
        if (expectedSessionId == null) {
            throw new IllegalArgumentException("expectedSessionId is required after control.hello");
        }
        return decodeControlMessage(text, expectedSessionId, previousSequence);
    }

    private ControlMessage decodeControlMessage(String text, UUID expectedSessionId, long previousSequence) {
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > BridgeProtocol.MAX_PAYLOAD_BYTES) {
            throw new ProtocolException("PAYLOAD_TOO_LARGE", "Family bridge payload exceeds 65536 bytes", 1009);
        }
        var root = exactObject(StrictJsonParser.parse(text), "envelope", ENVELOPE_FIELDS, Set.of());
        if (!BridgeProtocol.PROTOCOL.equals(string(root, "protocol", 1, 64))
            || integer(root, "version", 1, Integer.MAX_VALUE) != BridgeProtocol.VERSION) {
            throw new ProtocolException("UNSUPPORTED_VERSION", "Family bridge protocol version is unsupported", 4406);
        }
        var messageId = uuid(root, "messageId");
        var sessionId = uuid(root, "sessionId");
        if (expectedSessionId != null && !sessionId.equals(expectedSessionId)) {
            throw new ProtocolException("SESSION_MISMATCH", "Message belongs to a different bridge session", 4409);
        }
        var sequence = integer(root, "seq", 1, BridgeProtocol.MAX_SAFE_INTEGER);
        if (sequence != previousSequence + 1) {
            throw new ProtocolException("SEQUENCE_MISMATCH", "Message sequence was replayed, reordered, or skipped", 4409);
        }
        var sentAt = timestamp(root, "sentAt");
        if (!BridgeProtocol.CONTROL_SOURCE.equals(string(root, "source", 1, 64))) {
            throw new ProtocolException("INVALID_SOURCE", "Expected control-plane message source");
        }
        var type = string(root, "type", 1, 64);
        if (!BridgeProtocol.CONTROL_TYPES.contains(type)) {
            throw new ProtocolException("UNSUPPORTED_MESSAGE", "Unsupported control message '" + type + "'");
        }
        var payload = object(root.get("payload"), type + ".payload");
        var envelope = new BridgeEnvelope(messageId, sessionId, sequence, sentAt, BridgeProtocol.CONTROL_SOURCE, type, payload);
        return switch (type) {
            case "control.hello" -> decodeHello(envelope, payload);
            case "control.ready" -> decodeReady(envelope, payload);
            case "action.execute" -> decodeExecute(envelope, payload);
            case "action.cancel" -> decodeCancel(envelope, payload);
            case "client.shutdown" -> decodeShutdown(envelope, payload);
            default -> throw new ProtocolException("UNSUPPORTED_MESSAGE", "Unsupported control message '" + type + "'");
        };
    }

    public String encodeClient(UUID sessionId, long sequence, String type, JsonObject payload) {
        if (sessionId == null || sequence < 1 || sequence > BridgeProtocol.MAX_SAFE_INTEGER || !BridgeProtocol.CLIENT_TYPES.contains(type)) {
            throw invalid("Invalid outgoing message metadata");
        }
        validateClientPayload(type, payload);
        var root = new JsonObject();
        root.addProperty("protocol", BridgeProtocol.PROTOCOL);
        root.addProperty("version", BridgeProtocol.VERSION);
        root.addProperty("messageId", UUID.randomUUID().toString());
        root.addProperty("sessionId", sessionId.toString());
        root.addProperty("seq", sequence);
        root.addProperty("sentAt", BridgeProtocol.WIRE_TIMESTAMP.format(Instant.now()));
        root.addProperty("source", BridgeProtocol.CLIENT_SOURCE);
        root.addProperty("type", type);
        root.add("payload", payload.deepCopy());
        var json = GSON.toJson(root);
        if (json.getBytes(StandardCharsets.UTF_8).length > BridgeProtocol.MAX_PAYLOAD_BYTES) {
            throw new ProtocolException("PAYLOAD_TOO_LARGE", "Outgoing payload exceeds 65536 bytes", 1009);
        }
        return json;
    }

    private ControlMessage.Hello decodeHello(BridgeEnvelope envelope, JsonObject value) {
        var payload = exactObject(value, "control.hello.payload", Set.of(
            "supportedVersions", "helloTimeoutMs", "heartbeatIntervalMs", "heartbeatTimeoutMs", "maxPayloadBytes"
        ), Set.of());
        var versions = array(payload, "supportedVersions", 1, 1);
        if (exactInteger(versions.get(0), "supportedVersions[0]", 1, 1) != 1
            || integer(payload, "maxPayloadBytes", 1, Integer.MAX_VALUE) != BridgeProtocol.MAX_PAYLOAD_BYTES) {
            throw invalid("control.hello contains unsupported protocol limits");
        }
        var heartbeat = Math.toIntExact(integer(payload, "heartbeatIntervalMs", 250, 30_000));
        var timeout = Math.toIntExact(integer(payload, "heartbeatTimeoutMs", 500, 120_000));
        if (timeout < heartbeat * 2L) {
            throw invalid("heartbeatTimeoutMs must be at least twice heartbeatIntervalMs");
        }
        return new ControlMessage.Hello(
            envelope,
            Math.toIntExact(integer(payload, "helloTimeoutMs", 1_000, 30_000)),
            heartbeat,
            timeout
        );
    }

    private ControlMessage.Ready decodeReady(BridgeEnvelope envelope, JsonObject value) {
        var payload = exactObject(value, "control.ready.payload", "heartbeatIntervalMs", "snapshotIntervalMs", "acceptedCapabilities");
        var accepted = capabilityList(array(payload, "acceptedCapabilities", 1, BridgeProtocol.ALL_CAPABILITIES.size()));
        return new ControlMessage.Ready(
            envelope,
            Math.toIntExact(integer(payload, "heartbeatIntervalMs", 250, 30_000)),
            Math.toIntExact(integer(payload, "snapshotIntervalMs", 250, 30_000)),
            accepted
        );
    }

    private ControlMessage.Execute decodeExecute(BridgeEnvelope envelope, JsonObject value) {
        var payload = exactObject(value, "action.execute.payload", "actionId", "deadlineAt", "action");
        var actionId = uuid(payload, "actionId");
        var deadlineAt = timestamp(payload, "deadlineAt");
        var action = exactObject(payload.get("action"), "action", "kind", "args");
        var kind = string(action, "kind", 1, 64);
        if (!BridgeProtocol.ACTION_KINDS.contains(kind)) {
            throw new ProtocolException("UNSUPPORTED_ACTION", "Unsupported action '" + kind + "'");
        }
        var args = object(action.get("args"), kind + ".args");
        validateAction(kind, args);
        return new ControlMessage.Execute(envelope, new ActionCommand(actionId, deadlineAt, kind, args));
    }

    private ControlMessage.Cancel decodeCancel(BridgeEnvelope envelope, JsonObject value) {
        var payload = exactObject(value, "action.cancel.payload", "actionId", "reason");
        var reason = string(payload, "reason", 8, 26);
        if (!CANCEL_REASONS.contains(reason)) {
            throw invalid("action.cancel reason is unsupported");
        }
        return new ControlMessage.Cancel(envelope, uuid(payload, "actionId"), reason);
    }

    private ControlMessage.Shutdown decodeShutdown(BridgeEnvelope envelope, JsonObject value) {
        var payload = exactObject(value, "client.shutdown.payload", "shutdownId", "deadlineAt");
        return new ControlMessage.Shutdown(envelope, uuid(payload, "shutdownId"), timestamp(payload, "deadlineAt"));
    }

    private void validateAction(String kind, JsonObject args) {
        switch (kind) {
            case "direct.say" -> {
                exactObject(args, kind + ".args", "text");
                var text = string(args, "text", 1, 256);
                if (text.startsWith("/")) {
                    throw new ProtocolException("UNSAFE_ACTION", "direct.say cannot send a Minecraft command");
                }
            }
            case "direct.lookAt" -> {
                exactObject(args, kind + ".args", "x", "y", "z", "durationMs");
                number(args, "x", -30_000_000, 30_000_000);
                number(args, "y", -2_048, 2_048);
                number(args, "z", -30_000_000, 30_000_000);
                integer(args, "durationMs", 50, 5_000);
            }
            case "direct.lookDelta" -> {
                exactObject(args, kind + ".args", "yawDelta", "pitchDelta", "durationMs");
                number(args, "yawDelta", -180, 180);
                number(args, "pitchDelta", -90, 90);
                integer(args, "durationMs", 50, 5_000);
            }
            case "direct.moveFor" -> {
                exactObject(args, kind + ".args", "forward", "strafe", "durationMs", "sprint", "sneak");
                number(args, "forward", -1, 1);
                number(args, "strafe", -1, 1);
                integer(args, "durationMs", 50, 5_000);
                if (bool(args, "sprint") && bool(args, "sneak")) {
                    throw invalid("direct.moveFor cannot sprint and sneak together");
                }
            }
            case "direct.jump", "direct.attack", "direct.respawn", "skill.escapeDanger" -> exactObject(args, kind + ".args");
            case "direct.selectSlot" -> {
                exactObject(args, kind + ".args", "slot");
                integer(args, "slot", 0, 8);
            }
            case "direct.use" -> {
                exactObject(args, kind + ".args", "hand");
                enumString(args, "hand", Set.of("main", "off"));
            }
            case "direct.interactBlock" -> {
                exactObject(args, kind + ".args", "blockId", "x", "y", "z", "hand");
                patternedString(args, "blockId", 3, 128, REGISTRY_ID);
                integer(args, "x", -30_000_000, 30_000_000);
                integer(args, "y", -2_048, 2_048);
                integer(args, "z", -30_000_000, 30_000_000);
                enumString(args, "hand", Set.of("main", "off"));
            }
            case "direct.interactEntity" -> {
                exactObject(args, kind + ".args", "entityUuid", "typeId", "hand");
                uuid(args, "entityUuid");
                patternedString(args, "typeId", 3, 128, REGISTRY_ID);
                enumString(args, "hand", Set.of("main", "off"));
            }
            case "direct.placeBlock" -> {
                exactObject(args, kind + ".args", "blockId", "x", "y", "z");
                patternedString(args, "blockId", 3, 128, REGISTRY_ID);
                integer(args, "x", -30_000_000, 30_000_000);
                integer(args, "y", -2_048, 2_048);
                integer(args, "z", -30_000_000, 30_000_000);
            }
            case "direct.placeNearbyBlock" -> {
                exactObject(args, kind + ".args", "blockId");
                patternedString(args, "blockId", 3, 128, REGISTRY_ID);
            }
            case "direct.dropItem" -> {
                exactObject(args, kind + ".args", "all");
                bool(args, "all");
            }
            case "direct.dropItemById" -> {
                exactObject(args, kind + ".args", "itemId", "all");
                patternedString(args, "itemId", 3, 128, REGISTRY_ID);
                bool(args, "all");
            }
            case "direct.selectItem" -> {
                exactObject(args, kind + ".args", "itemId");
                patternedString(args, "itemId", 3, 128, REGISTRY_ID);
            }
            case "direct.swingHand" -> {
                exactObject(args, kind + ".args", "hand");
                enumString(args, "hand", Set.of("main", "off"));
            }
            case "skill.navigateTo" -> {
                exactObject(args, kind + ".args", "x", "y", "z", "tolerance");
                integer(args, "x", -30_000_000, 30_000_000);
                integer(args, "y", -2_048, 2_048);
                integer(args, "z", -30_000_000, 30_000_000);
                integer(args, "tolerance", 1, 16);
            }
            case "skill.followPlayer" -> {
                exactObject(args, kind + ".args", "playerUuid", "distance");
                uuid(args, "playerUuid");
                number(args, "distance", 2, 16);
            }
            case "skill.gatherBlock" -> {
                exactObject(args, kind + ".args", "blockId", "count", "maxDistance");
                patternedString(args, "blockId", 3, 128, REGISTRY_ID);
                integer(args, "count", 1, 64);
                integer(args, "maxDistance", 1, 128);
            }
            case "skill.explore" -> {
                exactObject(args, kind + ".args", "radius");
                integer(args, "radius", 16, 1_024);
            }
            case "skill.returnToKnownSafePoint" -> {
                exactObject(args, kind + ".args", "safePointId");
                patternedString(args, "safePointId", 1, 64, SAFE_CODE);
            }
            default -> throw new ProtocolException("UNSUPPORTED_ACTION", "Unsupported action '" + kind + "'");
        }
    }

    private List<String> capabilityList(JsonArray values) {
        var result = new ArrayList<String>();
        var unique = new HashSet<String>();
        for (JsonElement value : values) {
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
                throw invalid("Capability list is invalid");
            }
            var capability = value.getAsString();
            if (!BridgeProtocol.ALL_CAPABILITIES.contains(capability) || !unique.add(capability)) {
                throw invalid("Capability list contains an unsupported or duplicate value");
            }
            result.add(capability);
        }
        return List.copyOf(result);
    }

    private void validateClientPayload(String type, JsonObject payload) {
        switch (type) {
            case "bridge.hello" -> {
                var value = exactObject(payload, type + ".payload", "clientId", "pid", "bridgeVersion", "minecraftVersion", "loaderVersion", "baritoneVersion", "capabilities");
                if (!BridgeProtocol.CLIENT_ID.equals(string(value, "clientId", 1, 64))) {
                    throw invalid("bridge.hello clientId is invalid");
                }
                integer(value, "pid", 1, 0xffffffffL);
                for (var key : List.of("bridgeVersion", "minecraftVersion", "loaderVersion", "baritoneVersion")) {
                    patternedString(value, key, 1, 64, VERSION_TEXT);
                }
                capabilityList(array(value, "capabilities", 1, BridgeProtocol.ALL_CAPABILITIES.size()));
            }
            case "bridge.heartbeat" -> validateHeartbeat(payload, type);
            case "state.snapshot" -> validateSnapshot(payload, type);
            case "action.status" -> validateActionStatus(payload, type);
            case "client.shutdownAck" -> {
                var value = exactObject(payload, type + ".payload", "shutdownId", "accepted");
                uuid(value, "shutdownId");
                if (!bool(value, "accepted")) {
                    throw invalid("client.shutdownAck must be accepted");
                }
            }
            default -> throw new ProtocolException("UNSUPPORTED_MESSAGE", "Unsupported client message '" + type + "'");
        }
    }

    private void validateHeartbeat(JsonObject payload, String type) {
        var value = exactObject(payload, type + ".payload", "clientTick", "phase", "activeActionId", "killSwitch");
        integer(value, "clientTick", 0, BridgeProtocol.MAX_SAFE_INTEGER);
        enumString(value, "phase", PHASES);
        nullableUuid(value, "activeActionId");
        bool(value, "killSwitch");
    }

    private void validateSnapshot(JsonObject payload, String type) {
        var value = exactObject(payload, type + ".payload",
            Set.of("snapshotId", "clientTick", "phase", "serverAlias", "player", "world", "baritone", "activeAction", "safety"),
            Set.of("inventory", "awareness"));
        uuid(value, "snapshotId");
        integer(value, "clientTick", 0, BridgeProtocol.MAX_SAFE_INTEGER);
        enumString(value, "phase", PHASES);
        nullableConstant(value, "serverAlias", "family-server");
        validatePlayer(value.get("player"));
        validateWorld(value.get("world"));
        if (value.has("inventory")) {
            validateInventory(value.get("inventory"));
        }
        if (value.has("awareness")) {
            validateAwareness(value.get("awareness"));
        }
        validateBaritone(object(value.get("baritone"), "state.snapshot.payload.baritone"));
        validateActiveAction(value.get("activeAction"));
        var safety = exactObject(value.get("safety"), "state.snapshot.payload.safety", "killSwitch");
        bool(safety, "killSwitch");
    }

    private void validateInventory(JsonElement element) {
        if (isNull(element)) {
            return;
        }
        var inventory = exactObject(element, "state.snapshot.payload.inventory",
            Set.of("items"), Set.of("hotbar", "selectedSlot"));
        var items = array(inventory, "items", 0, 64);
        var seen = new HashSet<String>();
        for (var itemElement : items) {
            var item = exactObject(itemElement, "state.snapshot.payload.inventory.items entry", "itemId", "count");
            var itemId = patternedString(item, "itemId", 3, 128, REGISTRY_ID);
            integer(item, "count", 1, 4_096);
            if (!seen.add(itemId)) {
                throw invalid("inventory contains a duplicate item ID");
            }
        }
        if (inventory.has("hotbar")) {
            var hotbar = array(inventory, "hotbar", 0, 9);
            var slots = new HashSet<Integer>();
            for (var entryElement : hotbar) {
                var entry = exactObject(entryElement, "inventory hotbar entry", "slot", "itemId", "count");
                var slot = Math.toIntExact(integer(entry, "slot", 0, 8));
                patternedString(entry, "itemId", 3, 128, REGISTRY_ID);
                integer(entry, "count", 1, 64);
                if (!slots.add(slot)) throw invalid("inventory hotbar contains a duplicate slot");
            }
        }
        if (inventory.has("selectedSlot")) integer(inventory, "selectedSlot", 0, 8);
    }

    private void validateAwareness(JsonElement element) {
        if (element.isJsonNull()) return;
        var awareness = exactObject(element, "state.snapshot.payload.awareness",
            Set.of("radius", "blocks", "players"), Set.of("entities", "crosshairTarget"));
        integer(awareness, "radius", 1, 16);
        var blocks = array(awareness, "blocks", 0, 64);
        var blockIds = new HashSet<String>();
        for (var blockElement : blocks) {
            var block = exactObject(blockElement, "awareness block", "blockId", "x", "y", "z", "distanceSq", "count");
            var blockId = patternedString(block, "blockId", 3, 128, REGISTRY_ID);
            integer(block, "x", -30_000_000, 30_000_000);
            integer(block, "y", -2_048, 2_048);
            integer(block, "z", -30_000_000, 30_000_000);
            integer(block, "distanceSq", 0, 1_024);
            integer(block, "count", 1, 4_096);
            if (!blockIds.add(blockId)) throw invalid("awareness blocks contain a duplicate block ID");
        }
        var players = array(awareness, "players", 0, 16);
        var playerIds = new HashSet<String>();
        for (var playerElement : players) {
            var player = exactObject(playerElement, "awareness player",
                Set.of("minecraftUuid", "displayName", "x", "y", "z", "distanceSq"), Set.of("visible", "heldItemId"));
            var playerId = uuid(player, "minecraftUuid").toString();
            string(player, "displayName", 1, 64);
            number(player, "x", -30_000_000, 30_000_000);
            number(player, "y", -2_048, 2_048);
            number(player, "z", -30_000_000, 30_000_000);
            number(player, "distanceSq", 0, 4_096);
            if (player.has("visible")) bool(player, "visible");
            if (player.has("heldItemId") && !isNull(player.get("heldItemId"))) patternedString(player, "heldItemId", 3, 128, REGISTRY_ID);
            if (!playerIds.add(playerId)) throw invalid("awareness players contain a duplicate UUID");
        }
        if (awareness.has("entities")) {
            var entities = array(awareness, "entities", 0, 32);
            var entityIds = new HashSet<String>();
            for (var entityElement : entities) {
                var entity = exactObject(entityElement, "awareness entity",
                    "entityUuid", "typeId", "displayName", "category", "x", "y", "z", "distanceSq", "visible", "alive", "itemId");
                var entityId = uuid(entity, "entityUuid").toString();
                patternedString(entity, "typeId", 3, 128, REGISTRY_ID);
                string(entity, "displayName", 1, 64);
                enumString(entity, "category", Set.of("hostile", "passive", "item", "other"));
                number(entity, "x", -30_000_000, 30_000_000);
                number(entity, "y", -2_048, 2_048);
                number(entity, "z", -30_000_000, 30_000_000);
                number(entity, "distanceSq", 0, 1_024);
                bool(entity, "visible");
                bool(entity, "alive");
                if (!isNull(entity.get("itemId"))) patternedString(entity, "itemId", 3, 128, REGISTRY_ID);
                if (!entityIds.add(entityId)) throw invalid("awareness entities contain a duplicate UUID");
            }
        }
        if (awareness.has("crosshairTarget")) validateCrosshairTarget(awareness.get("crosshairTarget"));
    }

    private void validateCrosshairTarget(JsonElement element) {
        var target = object(element, "awareness crosshairTarget");
        var kind = string(target, "kind", 4, 6);
        switch (kind) {
            case "miss" -> exactObject(target, "awareness crosshairTarget", "kind");
            case "block" -> {
                exactObject(target, "awareness crosshairTarget", "kind", "blockId", "x", "y", "z", "distanceSq");
                patternedString(target, "blockId", 3, 128, REGISTRY_ID);
                integer(target, "x", -30_000_000, 30_000_000);
                integer(target, "y", -2_048, 2_048);
                integer(target, "z", -30_000_000, 30_000_000);
                number(target, "distanceSq", 0, 1_024);
            }
            case "entity" -> {
                exactObject(target, "awareness crosshairTarget", "kind", "entityUuid", "typeId", "x", "y", "z", "distanceSq");
                uuid(target, "entityUuid");
                patternedString(target, "typeId", 3, 128, REGISTRY_ID);
                number(target, "x", -30_000_000, 30_000_000);
                number(target, "y", -2_048, 2_048);
                number(target, "z", -30_000_000, 30_000_000);
                number(target, "distanceSq", 0, 1_024);
            }
            default -> throw invalid("awareness crosshair target kind is invalid");
        }
    }

    private void validatePlayer(JsonElement element) {
        if (isNull(element)) {
            return;
        }
        var player = exactObject(element, "state.snapshot.payload.player",
            Set.of("position", "velocity", "yaw", "pitch", "health", "maxHealth", "hunger", "armor", "dimension"),
            Set.of("air", "inWater", "onFire"));
        validateVector(player.get("position"), "player.position", 30_000_000);
        validateVector(player.get("velocity"), "player.velocity", 1_024);
        number(player, "yaw", -180, 180);
        number(player, "pitch", -90, 90);
        var health = number(player, "health", 0, 2_048);
        var maxHealth = number(player, "maxHealth", 1, 2_048);
        if (health > maxHealth) {
            throw invalid("health cannot exceed maxHealth");
        }
        integer(player, "hunger", 0, 20);
        integer(player, "armor", 0, 30);
        patternedString(player, "dimension", 3, 128, REGISTRY_ID);
        if (player.has("air")) integer(player, "air", 0, 300);
        if (player.has("inWater")) bool(player, "inWater");
        if (player.has("onFire")) bool(player, "onFire");
    }

    private void validateVector(JsonElement element, String label, double absoluteLimit) {
        var vector = exactObject(element, label, "x", "y", "z");
        number(vector, "x", -absoluteLimit, absoluteLimit);
        number(vector, "y", -absoluteLimit, absoluteLimit);
        number(vector, "z", -absoluteLimit, absoluteLimit);
    }

    private void validateWorld(JsonElement element) {
        if (isNull(element)) {
            return;
        }
        var world = exactObject(element, "state.snapshot.payload.world", "timeOfDay", "weather");
        integer(world, "timeOfDay", 0, 23_999);
        enumString(world, "weather", Set.of("clear", "rain", "thunder"));
    }

    private void validateBaritone(JsonObject value) {
        var baritone = exactObject(value, "state.snapshot.payload.baritone", "state", "activeSkill", "goal");
        enumString(baritone, "state", BARITONE_STATES);
        nullableEnum(baritone, "activeSkill", BridgeProtocol.ACTION_KINDS);
        var goalElement = baritone.get("goal");
        if (isNull(goalElement)) {
            return;
        }
        var goal = object(goalElement, "state.snapshot.payload.baritone.goal");
        var kind = string(goal, "kind", 1, 32);
        switch (kind) {
            case "block" -> {
                exactObject(goal, "baritone.goal", "kind", "x", "y", "z");
                integer(goal, "x", -30_000_000, 30_000_000);
                integer(goal, "y", -2_048, 2_048);
                integer(goal, "z", -30_000_000, 30_000_000);
            }
            case "follow-player" -> {
                exactObject(goal, "baritone.goal", "kind", "playerUuid");
                uuid(goal, "playerUuid");
            }
            case "explore" -> {
                exactObject(goal, "baritone.goal", "kind", "radius");
                integer(goal, "radius", 16, 1_024);
            }
            default -> throw invalid("baritone goal kind is invalid");
        }
    }

    private void validateActiveAction(JsonElement element) {
        if (isNull(element)) {
            return;
        }
        var active = exactObject(element, "state.snapshot.payload.activeAction", "actionId", "kind", "status");
        uuid(active, "actionId");
        enumString(active, "kind", BridgeProtocol.ACTION_KINDS);
        enumString(active, "status", Set.of("started", "progress"));
    }

    private void validateActionStatus(JsonObject payload, String type) {
        var status = string(payload, "status", 6, 9);
        switch (status) {
            case "started" -> exactObject(payload, type + ".payload", "actionId", "status");
            case "progress" -> {
                exactObject(payload, type + ".payload", "actionId", "status", "progress");
                var progress = exactObject(payload.get("progress"), "action.status.progress", Set.of("phase"), Set.of("percent", "detail"));
                patternedString(progress, "phase", 1, 64, SAFE_CODE);
                if (progress.has("percent")) {
                    number(progress, "percent", 0, 100);
                }
                if (progress.has("detail")) {
                    string(progress, "detail", 1, 256);
                }
            }
            case "succeeded" -> {
                exactObject(payload, type + ".payload", "actionId", "status", "result");
                var result = exactObject(payload.get("result"), "action.status.result", "code");
                patternedString(result, "code", 1, 64, SAFE_CODE);
            }
            case "failed" -> {
                exactObject(payload, type + ".payload", "actionId", "status", "error");
                var error = exactObject(payload.get("error"), "action.status.error", "code", "message");
                patternedString(error, "code", 1, 64, SAFE_CODE);
                string(error, "message", 1, 512);
            }
            case "cancelled" -> {
                exactObject(payload, type + ".payload", "actionId", "status", "cancellation");
                var cancellation = exactObject(payload.get("cancellation"), "action.status.cancellation", "reason");
                enumString(cancellation, "reason", CLIENT_CANCEL_REASONS);
            }
            default -> throw invalid("action.status status is invalid");
        }
        uuid(payload, "actionId");
    }

    private String enumString(JsonObject object, String key, Set<String> allowed) {
        var value = string(object, key, 1, 64);
        if (!allowed.contains(value)) {
            throw invalid(key + " is unsupported");
        }
        return value;
    }

    private UUID nullableUuid(JsonObject object, String key) {
        if (isNull(object.get(key))) {
            return null;
        }
        return uuid(object, key);
    }

    private void nullableEnum(JsonObject object, String key, Set<String> allowed) {
        if (!isNull(object.get(key))) {
            enumString(object, key, allowed);
        }
    }

    private void nullableConstant(JsonObject object, String key, String expected) {
        if (!isNull(object.get(key)) && !expected.equals(string(object, key, 1, 64))) {
            throw invalid(key + " is unsupported");
        }
    }

    private boolean isNull(JsonElement value) {
        return value == null || value.isJsonNull();
    }

    private long exactInteger(JsonElement value, String label, long min, long max) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw invalid(label + " must be an integer");
        }
        try {
            var result = value.getAsBigDecimal().longValueExact();
            if (result < min || result > max) {
                throw invalid(label + " is outside its allowed range");
            }
            return result;
        } catch (ArithmeticException error) {
            throw invalid(label + " must be an integer");
        }
    }
}

package com.mastermind.minecraft.familyagent.protocol;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class BridgeCodecTest {
    private static final UUID SESSION = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private final BridgeCodec codec = new BridgeCodec();

    @Test
    void decodesStrictControlHello() {
        var payload = new JsonObject();
        var versions = new JsonArray();
        versions.add(1);
        payload.add("supportedVersions", versions);
        payload.addProperty("helloTimeoutMs", 5_000);
        payload.addProperty("heartbeatIntervalMs", 1_000);
        payload.addProperty("heartbeatTimeoutMs", 3_000);
        payload.addProperty("maxPayloadBytes", 65_536);

        var message = codec.decodeInitialHello(envelope("control.hello", payload, 1).toString());

        var hello = assertInstanceOf(ControlMessage.Hello.class, message);
        assertEquals(1_000, hello.heartbeatIntervalMs());
        assertEquals(3_000, hello.heartbeatTimeoutMs());
    }

    @Test
    void firstHelloBindsSessionAndLaterFramesMustBeContiguous() {
        var helloPayload = new JsonObject();
        var versions = new JsonArray();
        versions.add(1);
        helloPayload.add("supportedVersions", versions);
        helloPayload.addProperty("helloTimeoutMs", 5_000);
        helloPayload.addProperty("heartbeatIntervalMs", 1_000);
        helloPayload.addProperty("heartbeatTimeoutMs", 3_000);
        helloPayload.addProperty("maxPayloadBytes", 65_536);
        var hello = codec.decodeInitialHello(envelope("control.hello", helloPayload, 1).toString());

        assertEquals(SESSION, hello.envelope().sessionId());
        assertThrows(ProtocolException.class, () -> codec.decodeInitialHello(envelope("action.cancel", cancelPayload(), 1).toString()));
        assertThrows(ProtocolException.class, () -> codec.decodeControl(envelope("action.cancel", cancelPayload(), 3).toString(), SESSION, 1));
    }

    @Test
    void rejectsNonIntegerSupportedVersionElements() {
        for (var invalid : new String[] { "\"1\"", "1.5", "true" }) {
            var payload = helloPayload();
            payload.add("supportedVersions", StrictJsonParser.parse("[" + invalid + "]").getAsJsonArray());
            assertThrows(ProtocolException.class, () -> codec.decodeInitialHello(envelope("control.hello", payload, 1).toString()));
        }
    }

    @Test
    void decodesSafeDirectMovement() {
        var args = new JsonObject();
        args.addProperty("forward", 1);
        args.addProperty("strafe", 0);
        args.addProperty("durationMs", 500);
        args.addProperty("sprint", true);
        args.addProperty("sneak", false);
        var action = new JsonObject();
        action.addProperty("kind", "direct.moveFor");
        action.add("args", args);
        var payload = new JsonObject();
        payload.addProperty("actionId", "22222222-2222-4222-8222-222222222222");
        payload.addProperty("deadlineAt", "2026-08-13T12:00:00.000Z");
        payload.add("action", action);

        var message = assertInstanceOf(
            ControlMessage.Execute.class,
            codec.decodeControl(envelope("action.execute", payload, 2).toString(), SESSION, 1)
        );
        assertEquals("direct.moveFor", message.action().kind());
        assertEquals(500, message.action().arguments().get("durationMs").getAsInt());
    }

    @Test
    void decodesAdvertisedRespawnWithExactEmptyArguments() {
        var message = assertInstanceOf(
            ControlMessage.Execute.class,
            codec.decodeControl(execute("direct.respawn", new JsonObject(), 2), SESSION, 1)
        );
        assertEquals("direct.respawn", message.action().kind());
        assertTrue(message.action().arguments().isEmpty());
    }

    @Test
    void decodesBoundedInventoryUseAndPlacementActions() {
        var slotArgs = new JsonObject();
        slotArgs.addProperty("slot", 2);
        var selected = assertInstanceOf(
            ControlMessage.Execute.class,
            codec.decodeControl(execute("direct.selectSlot", slotArgs, 2), SESSION, 1)
        );
        assertEquals(2, selected.action().arguments().get("slot").getAsInt());

        var useArgs = new JsonObject();
        useArgs.addProperty("hand", "main");
        codec.decodeControl(execute("direct.use", useArgs, 3), SESSION, 2);

        var placeArgs = new JsonObject();
        placeArgs.addProperty("blockId", "minecraft:oak_planks");
        placeArgs.addProperty("x", 10);
        placeArgs.addProperty("y", 64);
        placeArgs.addProperty("z", -20);
        codec.decodeControl(execute("direct.placeBlock", placeArgs, 4), SESSION, 3);

        var nearbyArgs = new JsonObject();
        nearbyArgs.addProperty("blockId", "minecraft:oak_planks");
        codec.decodeControl(execute("direct.placeNearbyBlock", nearbyArgs, 5), SESSION, 4);

        var dropArgs = new JsonObject();
        dropArgs.addProperty("all", false);
        codec.decodeControl(execute("direct.dropItem", dropArgs, 6), SESSION, 5);

        var namedDropArgs = new JsonObject();
        namedDropArgs.addProperty("itemId", "minecraft:cooked_beef");
        namedDropArgs.addProperty("all", false);
        codec.decodeControl(execute("direct.dropItemById", namedDropArgs, 7), SESSION, 6);

        var itemArgs = new JsonObject();
        itemArgs.addProperty("itemId", "minecraft:oak_planks");
        codec.decodeControl(execute("direct.selectItem", itemArgs, 8), SESSION, 7);

        var swingArgs = new JsonObject();
        swingArgs.addProperty("hand", "main");
        codec.decodeControl(execute("direct.swingHand", swingArgs, 9), SESSION, 8);
    }

    @Test
    void rejectsCommandsUnsafeFlagsUnknownFieldsReplaysAndDuplicateKeys() {
        var sayArgs = new JsonObject();
        sayArgs.addProperty("text", "/op somebody");
        assertThrows(ProtocolException.class, () -> codec.decodeControl(execute("direct.say", sayArgs, 1), SESSION, 0));

        var moveArgs = new JsonObject();
        moveArgs.addProperty("forward", 1);
        moveArgs.addProperty("strafe", 0);
        moveArgs.addProperty("durationMs", 500);
        moveArgs.addProperty("sprint", true);
        moveArgs.addProperty("sneak", true);
        assertThrows(ProtocolException.class, () -> codec.decodeControl(execute("direct.moveFor", moveArgs, 2), SESSION, 1));

        var unknown = envelope("action.cancel", cancelPayload(), 3);
        unknown.addProperty("extra", true);
        assertThrows(ProtocolException.class, () -> codec.decodeControl(unknown.toString(), SESSION, 2));
        assertThrows(ProtocolException.class, () -> codec.decodeControl(envelope("action.cancel", cancelPayload(), 3).toString(), SESSION, 3));

        var duplicate = envelope("action.cancel", cancelPayload(), 4).toString().replace("\"seq\":4", "\"seq\":4,\"seq\":5");
        assertThrows(ProtocolException.class, () -> codec.decodeControl(duplicate, SESSION, 3));
    }

    @Test
    void encodesCanonicalBoundedClientEnvelope() {
        var payload = new JsonObject();
        payload.addProperty("clientId", "family-ai-client");
        payload.addProperty("pid", 42);
        payload.addProperty("bridgeVersion", "0.1.0");
        payload.addProperty("minecraftVersion", "26.2");
        payload.addProperty("loaderVersion", "0.19.3");
        payload.addProperty("baritoneVersion", "unavailable");
        var capabilities = new JsonArray();
        BridgeProtocol.BASE_CAPABILITIES.forEach(capabilities::add);
        payload.add("capabilities", capabilities);

        var encoded = codec.encodeClient(SESSION, 1, "bridge.hello", payload);

        var parsed = StrictJsonParser.parse(encoded).getAsJsonObject();
        assertEquals("mastermind.family-bridge", parsed.get("protocol").getAsString());
        assertEquals("family-agent-bridge", parsed.get("source").getAsString());
        assertEquals(SESSION.toString(), parsed.get("sessionId").getAsString());
    }

    @Test
    void validatesNestedOutboundPayloadsBeforeEncoding() {
        var heartbeat = new JsonObject();
        heartbeat.addProperty("clientTick", 12);
        heartbeat.addProperty("phase", "in-world");
        heartbeat.add("activeActionId", null);
        heartbeat.addProperty("killSwitch", false);
        var encodedHeartbeat = codec.encodeClient(SESSION, 2, "bridge.heartbeat", heartbeat);
        var encodedHeartbeatPayload = StrictJsonParser.parse(encodedHeartbeat).getAsJsonObject().getAsJsonObject("payload");
        assertTrue(encodedHeartbeatPayload.has("activeActionId"));
        assertTrue(encodedHeartbeatPayload.get("activeActionId").isJsonNull());

        heartbeat.addProperty("phase", "teleporting");
        assertThrows(ProtocolException.class, () -> codec.encodeClient(SESSION, 3, "bridge.heartbeat", heartbeat));

        var failed = new JsonObject();
        failed.addProperty("actionId", "22222222-2222-4222-8222-222222222222");
        failed.addProperty("status", "failed");
        var error = new JsonObject();
        error.addProperty("code", "agent-busy");
        error.addProperty("message", "Another foreground action is active");
        failed.add("error", error);
        codec.encodeClient(SESSION, 4, "action.status", failed);

        error.addProperty("unexpected", true);
        assertThrows(ProtocolException.class, () -> codec.encodeClient(SESSION, 5, "action.status", failed));

        var ack = new JsonObject();
        ack.addProperty("shutdownId", "33333333-3333-4333-8333-333333333333");
        ack.addProperty("accepted", false);
        assertThrows(ProtocolException.class, () -> codec.encodeClient(SESSION, 6, "client.shutdownAck", ack));
    }

    @Test
    void validatesBoundedInventoryTelemetry() {
        var snapshot = StrictJsonParser.parse("""
            {"snapshotId":"44444444-4444-4444-8444-444444444444","clientTick":1,"phase":"in-world",
             "serverAlias":"family-server","player":{"position":{"x":1,"y":64,"z":2},"velocity":{"x":0,"y":0,"z":0},
             "yaw":0,"pitch":0,"health":20,"maxHealth":20,"hunger":20,"armor":0,"dimension":"minecraft:overworld"},
             "world":{"timeOfDay":1000,"weather":"clear"},"inventory":{"items":[{"itemId":"minecraft:oak_log","count":3}]},
             "baritone":{"state":"idle","activeSkill":null,"goal":null},"activeAction":null,"safety":{"killSwitch":false}}
            """).getAsJsonObject();
        codec.encodeClient(SESSION, 1, "state.snapshot", snapshot);

        snapshot.getAsJsonObject("inventory").getAsJsonArray("items").add(
            StrictJsonParser.parse("{\"itemId\":\"minecraft:oak_log\",\"count\":1}")
        );
        assertThrows(ProtocolException.class, () -> codec.encodeClient(SESSION, 2, "state.snapshot", snapshot));
    }

    private String execute(String kind, JsonObject args, long sequence) {
        var action = new JsonObject();
        action.addProperty("kind", kind);
        action.add("args", args);
        var payload = new JsonObject();
        payload.addProperty("actionId", "22222222-2222-4222-8222-222222222222");
        payload.addProperty("deadlineAt", "2026-08-13T12:00:00.000Z");
        payload.add("action", action);
        return envelope("action.execute", payload, sequence).toString();
    }

    private JsonObject cancelPayload() {
        var payload = new JsonObject();
        payload.addProperty("actionId", "22222222-2222-4222-8222-222222222222");
        payload.addProperty("reason", "operator");
        return payload;
    }

    private JsonObject helloPayload() {
        var payload = new JsonObject();
        var versions = new JsonArray();
        versions.add(1);
        payload.add("supportedVersions", versions);
        payload.addProperty("helloTimeoutMs", 5_000);
        payload.addProperty("heartbeatIntervalMs", 1_000);
        payload.addProperty("heartbeatTimeoutMs", 3_000);
        payload.addProperty("maxPayloadBytes", 65_536);
        return payload;
    }

    private JsonObject envelope(String type, JsonObject payload, long sequence) {
        var result = new JsonObject();
        result.addProperty("protocol", "mastermind.family-bridge");
        result.addProperty("version", 1);
        result.addProperty("messageId", UUID.randomUUID().toString());
        result.addProperty("sessionId", SESSION.toString());
        result.addProperty("seq", sequence);
        result.addProperty("sentAt", BridgeProtocol.WIRE_TIMESTAMP.format(Instant.parse("2026-08-13T06:00:00Z")));
        result.addProperty("source", "control-plane");
        result.addProperty("type", type);
        result.add("payload", payload);
        return result;
    }
}

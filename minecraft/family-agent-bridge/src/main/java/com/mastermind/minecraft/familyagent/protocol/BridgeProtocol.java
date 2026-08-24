package com.mastermind.minecraft.familyagent.protocol;

import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.List;
import java.util.Set;

public final class BridgeProtocol {
    public static final String PROTOCOL = "mastermind.family-bridge";
    public static final int VERSION = 1;
    public static final String SUBPROTOCOL = "mastermind.family.v1";
    public static final int MAX_PAYLOAD_BYTES = 64 * 1024;
    public static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    public static final String CLIENT_ID = "family-ai-client";
    public static final String CLIENT_SOURCE = "family-agent-bridge";
    public static final String CONTROL_SOURCE = "control-plane";
    public static final DateTimeFormatter WIRE_TIMESTAMP = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();

    public static final List<String> BASE_CAPABILITIES = List.of(
        "state.snapshot",
        "state.inventory",
        "state.localAwareness",
        "action.cancel",
        "client.shutdown",
        "direct.say",
        "direct.respawn",
        "direct.lookAt",
        "direct.lookDelta",
        "direct.moveFor",
        "direct.jump",
        "direct.attack",
        "direct.selectSlot",
        "direct.use",
        "direct.interactBlock",
        "direct.interactEntity",
        "direct.placeBlock",
        "direct.placeNearbyBlock",
        "direct.dropItem",
        "direct.dropItemById",
        "direct.selectItem",
        "direct.swingHand"
    );

    public static final Set<String> ALL_CAPABILITIES = Set.of(
        "state.snapshot", "state.inventory", "state.localAwareness", "action.cancel", "client.shutdown",
        "direct.say", "direct.respawn", "direct.lookAt", "direct.lookDelta", "direct.moveFor", "direct.jump", "direct.attack",
        "direct.selectSlot", "direct.use", "direct.interactBlock", "direct.interactEntity", "direct.placeBlock", "direct.placeNearbyBlock", "direct.dropItem", "direct.dropItemById", "direct.selectItem", "direct.swingHand",
        "skill.navigateTo", "skill.followPlayer", "skill.gatherBlock", "skill.explore", "skill.escapeDanger",
        "skill.returnToKnownSafePoint"
    );

    public static final Set<String> ACTION_KINDS = Set.of(
        "direct.say", "direct.respawn", "direct.lookAt", "direct.lookDelta", "direct.moveFor", "direct.jump", "direct.attack",
        "direct.selectSlot", "direct.use", "direct.interactBlock", "direct.interactEntity", "direct.placeBlock", "direct.placeNearbyBlock", "direct.dropItem", "direct.dropItemById", "direct.selectItem", "direct.swingHand",
        "skill.navigateTo", "skill.followPlayer", "skill.gatherBlock", "skill.explore", "skill.escapeDanger",
        "skill.returnToKnownSafePoint"
    );

    public static final Set<String> CONTROL_TYPES = Set.of(
        "control.hello", "control.ready", "action.execute", "action.cancel", "client.shutdown"
    );

    public static final Set<String> CLIENT_TYPES = Set.of(
        "bridge.hello", "bridge.heartbeat", "state.snapshot", "action.status", "client.shutdownAck"
    );

    private BridgeProtocol() {
    }
}

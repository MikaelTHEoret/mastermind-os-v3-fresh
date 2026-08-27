package com.mastermind.minecraft.familyagent.protocol;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;

import java.util.Collection;
import java.util.UUID;

public final class ClientPayloads {
    private ClientPayloads() {
    }

    public static JsonObject hello(long pid, String bridgeVersion, String minecraftVersion, String loaderVersion,
                                   String baritoneVersion, Collection<String> capabilities) {
        var payload = new JsonObject();
        payload.addProperty("clientId", BridgeProtocol.CLIENT_ID);
        payload.addProperty("pid", pid);
        payload.addProperty("bridgeVersion", bridgeVersion);
        payload.addProperty("minecraftVersion", minecraftVersion);
        payload.addProperty("loaderVersion", loaderVersion);
        payload.addProperty("baritoneVersion", baritoneVersion);
        var values = new JsonArray();
        capabilities.forEach(values::add);
        payload.add("capabilities", values);
        return payload;
    }

    public static JsonObject heartbeat(long clientTick, String phase, UUID activeActionId, boolean killSwitch) {
        var payload = new JsonObject();
        payload.addProperty("clientTick", clientTick);
        payload.addProperty("phase", phase);
        if (activeActionId == null) {
            payload.add("activeActionId", JsonNull.INSTANCE);
        } else {
            payload.addProperty("activeActionId", activeActionId.toString());
        }
        payload.addProperty("killSwitch", killSwitch);
        return payload;
    }

    public static JsonObject actionStarted(UUID actionId) {
        return actionStatus(actionId, "started");
    }

    public static JsonObject actionSucceeded(UUID actionId, String code) {
        var payload = actionStatus(actionId, "succeeded");
        var result = new JsonObject();
        result.addProperty("code", code);
        payload.add("result", result);
        return payload;
    }

    public static JsonObject actionFailed(UUID actionId, String code, String message) {
        var payload = actionStatus(actionId, "failed");
        var error = new JsonObject();
        error.addProperty("code", code);
        error.addProperty("message", message);
        payload.add("error", error);
        return payload;
    }

    public static JsonObject actionCancelled(UUID actionId, String reason) {
        var payload = actionStatus(actionId, "cancelled");
        var cancellation = new JsonObject();
        cancellation.addProperty("reason", reason);
        payload.add("cancellation", cancellation);
        return payload;
    }

    public static JsonObject shutdownAck(UUID shutdownId) {
        var payload = new JsonObject();
        payload.addProperty("shutdownId", shutdownId.toString());
        payload.addProperty("accepted", true);
        return payload;
    }

    private static JsonObject actionStatus(UUID actionId, String status) {
        var payload = new JsonObject();
        payload.addProperty("actionId", actionId.toString());
        payload.addProperty("status", status);
        return payload;
    }
}

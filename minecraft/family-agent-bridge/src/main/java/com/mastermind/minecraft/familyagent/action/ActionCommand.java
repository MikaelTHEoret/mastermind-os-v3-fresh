package com.mastermind.minecraft.familyagent.action;

import com.google.gson.JsonObject;

import java.time.Instant;
import java.util.UUID;

public record ActionCommand(UUID actionId, Instant deadlineAt, String kind, JsonObject arguments) {
    public ActionCommand {
        arguments = arguments.deepCopy();
    }

    @Override
    public JsonObject arguments() {
        return arguments.deepCopy();
    }
}


package com.mastermind.minecraft.familyagent.protocol;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.time.Instant;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

final class JsonFields {
    static final Pattern SAFE_CODE = Pattern.compile("^[a-z0-9][a-z0-9._-]{0,63}$");
    static final Pattern REGISTRY_ID = Pattern.compile("^(?!https?:|file:)[a-z0-9_.-]+:[a-z0-9_][a-z0-9_./-]*$");
    static final Pattern VERSION_TEXT = Pattern.compile("^[0-9A-Za-z][0-9A-Za-z._+\\-]{0,63}$");
    private static final Pattern CONTROL_CHAR = Pattern.compile("[\\x00-\\x1f\\x7f]");

    private JsonFields() {
    }

    static JsonObject object(JsonElement value, String label) {
        if (value == null || !value.isJsonObject()) {
            throw invalid(label + " must be an object");
        }
        return value.getAsJsonObject();
    }

    static JsonObject exactObject(JsonElement value, String label, Set<String> required, Set<String> optional) {
        var object = object(value, label);
        var allowed = new HashSet<>(required);
        allowed.addAll(optional);
        for (var key : object.keySet()) {
            if (!allowed.contains(key)) {
                throw new ProtocolException("UNKNOWN_FIELD", label + " contains unsupported field '" + key + "'");
            }
        }
        for (var key : required) {
            if (!object.has(key)) {
                throw new ProtocolException("MISSING_FIELD", label + " omitted required field '" + key + "'");
            }
        }
        return object;
    }

    static JsonObject exactObject(JsonElement value, String label, String... required) {
        return exactObject(value, label, Set.copyOf(Arrays.asList(required)), Set.of());
    }

    static String string(JsonObject object, String key, int min, int max) {
        var value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw invalid(key + " must be a string");
        }
        var result = value.getAsString();
        if (result.length() < min || result.length() > max || CONTROL_CHAR.matcher(result).find()) {
            throw invalid(key + " is invalid");
        }
        return result;
    }

    static String patternedString(JsonObject object, String key, int min, int max, Pattern pattern) {
        var result = string(object, key, min, max);
        if (!pattern.matcher(result).matches()) {
            throw invalid(key + " has an invalid format");
        }
        return result;
    }

    static UUID uuid(JsonObject object, String key) {
        var value = string(object, key, 36, 36);
        try {
            var parsed = UUID.fromString(value);
            if (!parsed.toString().equalsIgnoreCase(value) || parsed.variant() != 2 || parsed.version() < 1 || parsed.version() > 5) {
                throw invalid(key + " must be a canonical UUID");
            }
            return parsed;
        } catch (IllegalArgumentException error) {
            throw invalid(key + " must be a canonical UUID");
        }
    }

    static Instant timestamp(JsonObject object, String key) {
        var value = string(object, key, 24, 24);
        try {
            var parsed = Instant.parse(value);
            if (!BridgeProtocol.WIRE_TIMESTAMP.format(parsed).equals(value)) {
                throw invalid(key + " must be a canonical UTC millisecond timestamp");
            }
            return parsed;
        } catch (RuntimeException error) {
            if (error instanceof ProtocolException protocol) {
                throw protocol;
            }
            throw invalid(key + " must be a canonical UTC millisecond timestamp");
        }
    }

    static long integer(JsonObject object, String key, long min, long max) {
        var value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw invalid(key + " must be an integer");
        }
        try {
            var decimal = value.getAsBigDecimal();
            var result = decimal.longValueExact();
            if (result < min || result > max) {
                throw invalid(key + " is outside its allowed range");
            }
            return result;
        } catch (ArithmeticException error) {
            throw invalid(key + " must be an integer");
        }
    }

    static double number(JsonObject object, String key, double min, double max) {
        var value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw invalid(key + " must be a number");
        }
        var result = value.getAsDouble();
        if (!Double.isFinite(result) || result < min || result > max) {
            throw invalid(key + " is outside its allowed range");
        }
        return result;
    }

    static boolean bool(JsonObject object, String key) {
        var value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) {
            throw invalid(key + " must be boolean");
        }
        return value.getAsBoolean();
    }

    static JsonArray array(JsonObject object, String key, int min, int max) {
        var value = object.get(key);
        if (value == null || !value.isJsonArray() || value.getAsJsonArray().size() < min || value.getAsJsonArray().size() > max) {
            throw invalid(key + " must be a bounded array");
        }
        return value.getAsJsonArray();
    }

    static ProtocolException invalid(String message) {
        return new ProtocolException("INVALID_MESSAGE", message);
    }
}

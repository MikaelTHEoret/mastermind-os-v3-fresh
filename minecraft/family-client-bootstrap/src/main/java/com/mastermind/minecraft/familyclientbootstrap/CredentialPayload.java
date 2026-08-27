package com.mastermind.minecraft.familyclientbootstrap;

import java.util.Arrays;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Mutable credential holder. This is intentionally not a record: a record's generated
 * {@code toString()} would disclose every authentication value.
 */
final class CredentialPayload implements AutoCloseable {
    static final int USERNAME_MAX_BYTES = 16;
    static final int UUID_MAX_BYTES = 36;
    static final int ACCESS_TOKEN_MAX_BYTES = 24 * 1024;
    static final int XUID_MAX_BYTES = 20;
    static final int CLIENT_ID_MAX_BYTES = 36;

    private static final Pattern UUID_COMPACT = Pattern.compile("[0-9A-Fa-f]{32}");
    private static final Pattern UUID_CANONICAL = Pattern.compile(
        "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
    );

    private final char[] username;
    private final char[] uuid;
    private final char[] accessToken;
    private final char[] xuid;
    private final char[] clientId;
    private boolean closed;

    CredentialPayload(char[] username, char[] uuid, char[] accessToken, char[] xuid, char[] clientId)
        throws BootstrapFailure {
        this.username = username;
        this.uuid = uuid;
        this.accessToken = accessToken;
        this.xuid = xuid;
        this.clientId = clientId;
        try {
            validate();
        } catch (BootstrapFailure failure) {
            close();
            throw failure;
        }
    }

    private void validate() throws BootstrapFailure {
        if (username.length < 1 || username.length > 16) {
            throw invalid("The Minecraft profile name length is invalid.");
        }
        for (char value : username) {
            if (!(value == '_' || value >= '0' && value <= '9' || value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z')) {
                throw invalid("The Minecraft profile name contains an unsupported character.");
            }
        }
        if (!isUuid(uuid)) throw invalid("The Minecraft profile UUID is invalid.");
        if (accessToken.length < 1 || accessToken.length > ACCESS_TOKEN_MAX_BYTES) {
            throw invalid("The Minecraft access token length is invalid.");
        }
        for (char value : accessToken) {
            if (value < 0x21 || value > 0x7e) {
                throw invalid("The Minecraft access token must contain visible ASCII characters only.");
            }
        }
        if (xuid.length < 1 || xuid.length > 20) throw invalid("The Xbox user identifier length is invalid.");
        for (char value : xuid) {
            if (value < '0' || value > '9') throw invalid("The Xbox user identifier must be decimal digits.");
        }
        if (!isUuid(clientId)) throw invalid("The Microsoft public-client application identifier is invalid.");
    }

    private static BootstrapFailure invalid(String message) {
        return new BootstrapFailure(BootstrapFailure.Kind.CREDENTIAL_FRAME_INVALID, message);
    }

    private static boolean isUuid(char[] value) {
        String candidate = new String(value);
        return UUID_COMPACT.matcher(candidate).matches() || UUID_CANONICAL.matcher(candidate).matches();
    }

    String usernameArgument() {
        ensureOpen();
        return new String(username);
    }

    String uuidArgument() {
        ensureOpen();
        return new String(uuid).replace("-", "").toLowerCase(Locale.ROOT);
    }

    String accessTokenArgument() {
        ensureOpen();
        return new String(accessToken);
    }

    String xuidArgument() {
        ensureOpen();
        return new String(xuid);
    }

    String clientIdArgument() {
        ensureOpen();
        String candidate = new String(clientId).toLowerCase(Locale.ROOT);
        if (candidate.indexOf('-') >= 0) return candidate;
        return candidate.substring(0, 8) + '-' + candidate.substring(8, 12) + '-' + candidate.substring(12, 16)
            + '-' + candidate.substring(16, 20) + '-' + candidate.substring(20);
    }

    private void ensureOpen() {
        if (closed) throw new IllegalStateException("Credential payload is closed.");
    }

    @Override
    public void close() {
        Arrays.fill(username, '\0');
        Arrays.fill(uuid, '\0');
        Arrays.fill(accessToken, '\0');
        Arrays.fill(xuid, '\0');
        Arrays.fill(clientId, '\0');
        closed = true;
    }

    boolean isCleared() {
        return closed && allZero(username) && allZero(uuid) && allZero(accessToken) && allZero(xuid) && allZero(clientId);
    }

    private static boolean allZero(char[] value) {
        for (char item : value) if (item != '\0') return false;
        return true;
    }

    @Override
    public String toString() {
        return "CredentialPayload[REDACTED]";
    }
}

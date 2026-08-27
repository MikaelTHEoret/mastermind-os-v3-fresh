package com.mastermind.minecraft.familyclientbootstrap;

import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

final class LaunchProfile {
    static final String SERVER_PORT_ENVIRONMENT_KEY = "MASTERMIND_FAMILY_SERVER_PORT";
    static final String SERVER_HOST = "127.0.0.1";

    private static final Set<String> REQUIRED_OPTIONS = Set.of(
        "--game-dir", "--assets-dir", "--asset-index", "--version", "--version-type"
    );
    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._+\\-]{0,63}");
    private static final Pattern ASSET_INDEX = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._\\-]{0,127}");

    private final Path gameDirectory;
    private final Path assetsDirectory;
    private final String assetIndex;
    private final String version;
    private final String versionType;
    private final int serverPort;

    private LaunchProfile(
        Path gameDirectory,
        Path assetsDirectory,
        String assetIndex,
        String version,
        String versionType,
        int serverPort
    ) {
        this.gameDirectory = gameDirectory;
        this.assetsDirectory = assetsDirectory;
        this.assetIndex = assetIndex;
        this.version = version;
        this.versionType = versionType;
        this.serverPort = serverPort;
    }

    static LaunchProfile parse(String[] arguments, Map<String, String> environment) throws BootstrapFailure {
        if (arguments == null || arguments.length != REQUIRED_OPTIONS.size() * 2) {
            throw invalid("The bootstrap requires exactly five non-secret profile options.");
        }
        Map<String, String> values = new HashMap<>();
        for (int index = 0; index < arguments.length; index += 2) {
            String key = arguments[index];
            String value = arguments[index + 1];
            if (!REQUIRED_OPTIONS.contains(key)) throw invalid("The bootstrap received an unsupported profile option.");
            if (values.putIfAbsent(key, value) != null) throw invalid("The bootstrap received a duplicate profile option.");
        }
        if (!values.keySet().equals(REQUIRED_OPTIONS)) throw invalid("The bootstrap profile omitted a required option.");

        Path gameDirectory = absolutePath(values.get("--game-dir"), "game directory");
        Path assetsDirectory = absolutePath(values.get("--assets-dir"), "assets directory");
        String assetIndex = identifier(values.get("--asset-index"), ASSET_INDEX, "asset index");
        String version = identifier(values.get("--version"), IDENTIFIER, "Minecraft version");
        String versionType = identifier(values.get("--version-type"), IDENTIFIER, "version type");
        if (environment == null) throw invalid("The Family Server port environment is unavailable.");
        String portText = environment.get(SERVER_PORT_ENVIRONMENT_KEY);
        int port;
        try {
            if (portText == null || !portText.matches("[0-9]{1,5}")) throw new NumberFormatException();
            port = Integer.parseInt(portText);
        } catch (NumberFormatException error) {
            throw invalid("The Family Server port is invalid.");
        }
        if (port < 1 || port > 65_535) throw invalid("The Family Server port is invalid.");
        return new LaunchProfile(gameDirectory, assetsDirectory, assetIndex, version, versionType, port);
    }

    private static Path absolutePath(String value, String label) throws BootstrapFailure {
        if (value == null || value.isBlank() || value.length() > 32_768 || containsControl(value)) {
            throw invalid("The " + label + " is invalid.");
        }
        try {
            Path candidate = Path.of(value);
            if (!candidate.isAbsolute()) throw invalid("The " + label + " must be absolute.");
            return candidate.normalize();
        } catch (InvalidPathException error) {
            throw invalid("The " + label + " is invalid.");
        }
    }

    private static String identifier(String value, Pattern pattern, String label) throws BootstrapFailure {
        if (value == null || !pattern.matcher(value).matches()) throw invalid("The " + label + " is invalid.");
        return value;
    }

    private static boolean containsControl(String value) {
        for (int index = 0; index < value.length(); index += 1) {
            char item = value.charAt(index);
            if (item == '\0' || item < 0x20 || item == 0x7f) return true;
        }
        return false;
    }

    private static BootstrapFailure invalid(String message) {
        return new BootstrapFailure(BootstrapFailure.Kind.PROFILE_INVALID, message);
    }

    Path gameDirectory() { return gameDirectory; }
    Path assetsDirectory() { return assetsDirectory; }
    String assetIndex() { return assetIndex; }
    String version() { return version; }
    String versionType() { return versionType; }
    int serverPort() { return serverPort; }
}


package com.mastermind.minecraft.familyagent.config;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.UnknownHostException;
import java.util.Locale;
import java.util.function.Predicate;

public final class FamilyServerAddressPolicy {
    private FamilyServerAddressPolicy() {
    }

    public static boolean isTrusted(String rawAddress, int expectedPort) {
        return isTrusted(rawAddress, expectedPort, FamilyServerAddressPolicy::isLocalInterfaceAddress);
    }

    static boolean isTrusted(String rawAddress, int expectedPort, Predicate<InetAddress> localAddressCheck) {
        if (rawAddress == null || expectedPort < 1 || expectedPort > 65_535 || localAddressCheck == null) {
            return false;
        }
        var parsed = parse(rawAddress, expectedPort);
        if (parsed == null) {
            return false;
        }
        if (parsed.host().equals("localhost")) {
            return true;
        }
        if (!isNumericAddress(parsed.host())) {
            return false;
        }
        try {
            var address = InetAddress.getByName(parsed.host());
            return address.isLoopbackAddress() || localAddressCheck.test(address);
        } catch (UnknownHostException | SecurityException ignored) {
            return false;
        }
    }

    private static ParsedAddress parse(String rawAddress, int expectedPort) {
        var value = rawAddress.trim().toLowerCase(Locale.ROOT);
        if (value.isEmpty()) {
            return null;
        }
        String host;
        int port = 25_565;
        if (value.startsWith("[")) {
            var end = value.indexOf(']');
            if (end < 2) {
                return null;
            }
            host = value.substring(1, end);
            if (end + 1 < value.length()) {
                if (value.charAt(end + 1) != ':') {
                    return null;
                }
                port = parsePort(value.substring(end + 2));
            }
        } else {
            var firstColon = value.indexOf(':');
            var lastColon = value.lastIndexOf(':');
            if (firstColon >= 0 && firstColon == lastColon) {
                host = value.substring(0, firstColon);
                port = parsePort(value.substring(firstColon + 1));
            } else {
                host = value;
            }
        }
        return host.isEmpty() || port != expectedPort ? null : new ParsedAddress(host, port);
    }

    private static int parsePort(String value) {
        try {
            var port = Integer.parseInt(value);
            return port >= 1 && port <= 65_535 ? port : -1;
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    private static boolean isNumericAddress(String host) {
        if (host.indexOf(':') >= 0) {
            return host.matches("[0-9a-f:.%]+") && !host.contains("%") && host.contains(":");
        }
        return host.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}");
    }

    private static boolean isLocalInterfaceAddress(InetAddress address) {
        try {
            return NetworkInterface.getByInetAddress(address) != null;
        } catch (SocketException | SecurityException ignored) {
            return false;
        }
    }

    private record ParsedAddress(String host, int port) {
    }
}

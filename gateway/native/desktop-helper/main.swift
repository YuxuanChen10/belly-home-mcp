import AppKit
import Darwin
import Foundation

private let snapshotLifetime: TimeInterval = 15 * 60
private let maximumMoves = 100

private struct HelperFailure: Error {
    let code: String
    let message: String
}

private struct ErrorResponse: Encodable {
    let status = "error"
    let code: String
    let message: String
}

private struct AuthorizationResponse: Encodable {
    let status: String
}

private struct DesktopItem: Codable {
    let filename: String
    let isDirectory: Bool
    let itemType: String
    let relativePath: String
    let `extension`: String
}

private struct SnapshotItem: Codable {
    let item: DesktopItem
    let device: UInt64
    let inode: UInt64
}

private struct Snapshot: Codable {
    let id: String
    let createdAt: Date
    let expiresAt: Date
    let items: [SnapshotItem]
}

private struct ListRequest: Decodable {}

private struct DesktopFolder: Encodable {
    let folderName: String
    let relativePath: String
}

private struct LooseFile: Encodable {
    let filename: String
    let relativePath: String
    let `extension`: String
}

private struct ListResponse: Encodable {
    let status = "ready"
    let snapshotId: String
    let folders: [DesktopFolder]
    let looseFiles: [LooseFile]
    let expiresAt: String
}

private struct MoveInstruction: Codable {
    let sourceRelativePath: String
    let destinationRelativePath: String
}

private struct MoveRequest: Decodable {
    let snapshotId: String
    let moves: [MoveInstruction]
}

private struct MoveResult: Encodable {
    let sourceRelativePath: String
    let destinationRelativePath: String
    let status: String
    let errorCode: String?
}

private struct MoveResponse: Encodable {
    let status: String
    let requestedCount: Int
    let movedCount: Int
    let failedCount: Int
    let results: [MoveResult]
}

private let encoder: JSONEncoder = {
    let value = JSONEncoder()
    value.outputFormatting = [.sortedKeys]
    value.dateEncodingStrategy = .iso8601
    return value
}()

private let decoder: JSONDecoder = {
    let value = JSONDecoder()
    value.dateDecodingStrategy = .iso8601
    return value
}()

private func writeResponse<T: Encodable>(_ response: T) throws {
    let data = try encoder.encode(response)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

private func readRequest<T: Decodable>(_ type: T.Type) throws -> T {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    if data.isEmpty {
        return try decoder.decode(type, from: Data("{}".utf8))
    }
    return try decoder.decode(type, from: data)
}

private func stateDirectory() throws -> URL {
#if DEBUG
    if let testState = ProcessInfo.processInfo.environment["BELLY_DESKTOP_TEST_STATE_DIR"] {
        let url = URL(fileURLWithPath: testState, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
#endif
    guard let applicationSupport = FileManager.default.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
    ).first else {
        throw HelperFailure(code: "STATE_UNAVAILABLE", message: "Application Support is unavailable")
    }
    let directory = applicationSupport.appendingPathComponent("Belly Home Desktop", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}

private func bookmarkFile() throws -> URL {
    try stateDirectory().appendingPathComponent("desktop.bookmark", isDirectory: false)
}

private func snapshotDirectory() throws -> URL {
    let directory = try stateDirectory().appendingPathComponent("snapshots", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}

private func snapshotFile(_ id: String) throws -> URL {
    guard UUID(uuidString: id) != nil else {
        throw HelperFailure(code: "INVALID_SNAPSHOT", message: "snapshotId is invalid")
    }
    return try snapshotDirectory().appendingPathComponent("\(id).json", isDirectory: false)
}

private func desktopURL() throws -> URL {
    guard let url = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first else {
        throw HelperFailure(code: "DESKTOP_UNAVAILABLE", message: "macOS did not provide the Desktop directory")
    }
    return url.standardizedFileURL
}

private func directoryIdentity(at url: URL) throws -> (UInt64, UInt64) {
    var value = stat()
    guard stat(url.path, &value) == 0, value.st_mode & S_IFMT == S_IFDIR else {
        throw HelperFailure(code: "DESKTOP_UNAVAILABLE", message: "The Desktop directory could not be inspected")
    }
    return (UInt64(value.st_dev), UInt64(value.st_ino))
}

private func isSameDirectory(_ left: URL, _ right: URL) throws -> Bool {
    let leftIdentity = try directoryIdentity(at: left)
    let rightIdentity = try directoryIdentity(at: right)
    return leftIdentity == rightIdentity
}

private func authorizeDesktop() throws -> AuthorizationResponse {
    let expected = try desktopURL()
    NSApplication.shared.setActivationPolicy(.accessory)
    NSApplication.shared.activate(ignoringOtherApps: true)

    let panel = NSOpenPanel()
    panel.title = "Authorize Belly Home Desktop"
    panel.message = "Confirm access to your Desktop workspace. Belly Home will only use names, relative structure, and approved move plans."
    panel.prompt = "Authorize Desktop"
    panel.directoryURL = expected
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.canCreateDirectories = false

    guard panel.runModal() == .OK, let selected = panel.url else {
        return AuthorizationResponse(status: "cancelled")
    }
    guard try isSameDirectory(selected, expected) else {
        throw HelperFailure(code: "DESKTOP_REQUIRED", message: "Select the Desktop location provided by macOS")
    }

    let bookmark = try selected.bookmarkData(
        options: .withSecurityScope,
        includingResourceValuesForKeys: nil,
        relativeTo: nil
    )
    try bookmark.write(to: bookmarkFile(), options: [.atomic, .completeFileProtection])
    return AuthorizationResponse(status: "authorized")
}

private func withAuthorizedDesktop<T>(_ operation: (URL) throws -> T) throws -> T {
#if DEBUG
    if let testRoot = ProcessInfo.processInfo.environment["BELLY_DESKTOP_TEST_ROOT"] {
        return try operation(URL(fileURLWithPath: testRoot, isDirectory: true).standardizedFileURL)
    }
#endif
    let file = try bookmarkFile()
    guard FileManager.default.fileExists(atPath: file.path) else {
        throw HelperFailure(
            code: "AUTHORIZATION_REQUIRED",
            message: "Desktop authorization is required. Run npm run desktop:authorize on the Mac."
        )
    }
    let bookmark = try Data(contentsOf: file)
    var stale = false
    let root = try URL(
        resolvingBookmarkData: bookmark,
        options: [.withSecurityScope, .withoutUI],
        relativeTo: nil,
        bookmarkDataIsStale: &stale
    )
    guard root.startAccessingSecurityScopedResource() else {
        throw HelperFailure(code: "AUTHORIZATION_REQUIRED", message: "Desktop authorization could not be activated")
    }
    defer { root.stopAccessingSecurityScopedResource() }

    guard try isSameDirectory(root, try desktopURL()) else {
        throw HelperFailure(code: "INVALID_AUTHORIZATION", message: "The stored authorization is not for the current Desktop workspace")
    }

    if stale {
        let refreshed = try root.bookmarkData(
            options: .withSecurityScope,
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        try refreshed.write(to: file, options: [.atomic, .completeFileProtection])
    }
    return try operation(root)
}

private func relativePath(for url: URL, root: URL) throws -> String {
    let rootPath = root.standardizedFileURL.path
    let itemPath = url.standardizedFileURL.path
    let prefix = rootPath.hasSuffix("/") ? rootPath : rootPath + "/"
    guard itemPath.hasPrefix(prefix) else {
        throw HelperFailure(code: "PATH_OUTSIDE_DESKTOP", message: "An item resolved outside Desktop")
    }
    return String(itemPath.dropFirst(prefix.count))
}

private func fileIdentity(at url: URL) throws -> (UInt64, UInt64) {
    var value = stat()
    guard lstat(url.path, &value) == 0 else {
        throw HelperFailure(code: "ITEM_UNAVAILABLE", message: "An item could not be inspected")
    }
    return (UInt64(value.st_dev), UInt64(value.st_ino))
}

private func listDesktopFirstLevel(_ root: URL) throws -> [SnapshotItem] {
    let keys: Set<URLResourceKey> = [.nameKey, .isDirectoryKey, .isSymbolicLinkKey, .isPackageKey]
    let urls = try FileManager.default.contentsOfDirectory(
        at: root,
        includingPropertiesForKeys: Array(keys),
        options: [.skipsHiddenFiles]
    )

    var items: [SnapshotItem] = []
    for url in urls {
        let values = try url.resourceValues(forKeys: keys)
        let isSymbolicLink = values.isSymbolicLink == true
        let isPackage = values.isPackage == true
        let isDirectory = values.isDirectory == true
        guard !isSymbolicLink, !isPackage else { continue }

        let type = isDirectory ? "folder" : "file"
        let path = try relativePath(for: url, root: root)
        let identity = try fileIdentity(at: url)
        items.append(SnapshotItem(
            item: DesktopItem(
                filename: values.name ?? url.lastPathComponent,
                isDirectory: type == "folder",
                itemType: type,
                relativePath: path,
                extension: url.pathExtension.lowercased()
            ),
            device: identity.0,
            inode: identity.1
        ))
    }
    return items.sorted {
        $0.item.relativePath.localizedStandardCompare($1.item.relativePath) == .orderedAscending
    }
}

private func cleanupExpiredSnapshots(now: Date) throws {
    let directory = try snapshotDirectory()
    let files = try FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
    )
    for file in files where file.pathExtension == "json" {
        guard let data = try? Data(contentsOf: file),
              let snapshot = try? decoder.decode(Snapshot.self, from: data),
              snapshot.expiresAt > now else {
            try? FileManager.default.removeItem(at: file)
            continue
        }
    }
}

private func saveSnapshot(_ snapshot: Snapshot) throws {
    let file = try snapshotFile(snapshot.id)
    try encoder.encode(snapshot).write(to: file, options: [.atomic, .completeFileProtection])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
}

private func loadSnapshot(_ id: String) throws -> Snapshot {
    let file = try snapshotFile(id)
    guard FileManager.default.fileExists(atPath: file.path) else {
        throw HelperFailure(code: "SNAPSHOT_NOT_FOUND", message: "The Desktop snapshot was not found")
    }
    let snapshot = try decoder.decode(Snapshot.self, from: Data(contentsOf: file))
    guard snapshot.expiresAt > Date() else {
        try? FileManager.default.removeItem(at: file)
        throw HelperFailure(code: "SNAPSHOT_EXPIRED", message: "The Desktop snapshot expired; read metadata again")
    }
    return snapshot
}

private func listMetadata(_: ListRequest) throws -> ListResponse {
    return try withAuthorizedDesktop { root in
        let now = Date()
        try cleanupExpiredSnapshots(now: now)
        let snapshot = Snapshot(
            id: UUID().uuidString.lowercased(),
            createdAt: now,
            expiresAt: now.addingTimeInterval(snapshotLifetime),
            items: try listDesktopFirstLevel(root)
        )
        try saveSnapshot(snapshot)

        let folders = snapshot.items.filter { $0.item.itemType == "folder" }.map {
            DesktopFolder(folderName: $0.item.filename, relativePath: $0.item.relativePath)
        }
        let looseFiles = snapshot.items.filter { $0.item.itemType == "file" }.map {
            LooseFile(
                filename: $0.item.filename,
                relativePath: $0.item.relativePath,
                extension: $0.item.extension
            )
        }
        return ListResponse(
            snapshotId: snapshot.id,
            folders: folders,
            looseFiles: looseFiles,
            expiresAt: ISO8601DateFormatter().string(from: snapshot.expiresAt)
        )
    }
}

private func validatedComponents(_ value: String) throws -> [String] {
    guard !value.isEmpty, value.utf8.count <= 2048, !value.hasPrefix("/"), !value.contains("\0") else {
        throw HelperFailure(code: "INVALID_RELATIVE_PATH", message: "A relative path is invalid")
    }
    let components = value.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    guard components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
        throw HelperFailure(code: "INVALID_RELATIVE_PATH", message: "A relative path is invalid")
    }
    return components
}

private func verifyCurrentIdentity(rootDescriptor: Int32, relativePath: String, expected: SnapshotItem) throws {
    var value = stat()
    let result = relativePath.withCString {
        fstatat(rootDescriptor, $0, &value, AT_SYMLINK_NOFOLLOW)
    }
    guard result == 0 else {
        throw HelperFailure(code: "ITEM_UNAVAILABLE", message: "A source item could not be inspected")
    }
    guard UInt64(value.st_dev) == expected.device, UInt64(value.st_ino) == expected.inode else {
        throw HelperFailure(code: "SOURCE_CHANGED", message: "A source item changed after the metadata snapshot")
    }
}

private func confirmMoves(_ moves: [MoveInstruction]) -> Bool {
#if DEBUG
    if let decision = ProcessInfo.processInfo.environment["BELLY_DESKTOP_TEST_CONFIRMATION"] {
        return decision == "approve"
    }
#endif
    NSApplication.shared.setActivationPolicy(.accessory)
    NSApplication.shared.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = "Allow Belly Home to move \(moves.count) Desktop item\(moves.count == 1 ? "" : "s")?"
    let preview = moves.prefix(20).map {
        "\($0.sourceRelativePath)  →  \($0.destinationRelativePath)"
    }.joined(separator: "\n")
    alert.informativeText = moves.count > 20
        ? preview + "\n…and \(moves.count - 20) more"
        : preview
    alert.addButton(withTitle: "Confirm Move")
    alert.addButton(withTitle: "Cancel")
    return alert.runModal() == .alertFirstButtonReturn
}

private func ensureDestinationFolder(rootDescriptor: Int32, folderName: String) throws {
    if folderName == "Default" {
        let result = folderName.withCString { mkdirat(rootDescriptor, $0, 0o700) }
        if result != 0 && errno != EEXIST {
            throw HelperFailure(code: "CREATE_FOLDER_FAILED", message: "Default could not be created")
        }
    }
    let descriptor = folderName.withCString {
        openat(rootDescriptor, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    }
    guard descriptor >= 0 else {
        throw HelperFailure(code: "UNSAFE_DESTINATION", message: "The destination is not a safe Desktop folder")
    }
    close(descriptor)
}

private func destinationExists(rootDescriptor: Int32, components: [String]) throws -> Bool {
    var descriptor = dup(rootDescriptor)
    guard descriptor >= 0 else {
        throw HelperFailure(code: "DESKTOP_UNAVAILABLE", message: "Desktop could not be opened")
    }
    defer { close(descriptor) }

    for component in components.dropLast() {
        let next = component.withCString {
            openat(descriptor, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        }
        if next < 0 && errno == ENOENT { return false }
        guard next >= 0 else {
            throw HelperFailure(code: "UNSAFE_DESTINATION", message: "A destination folder is not a safe directory")
        }
        close(descriptor)
        descriptor = next
    }

    var value = stat()
    let result = components.last!.withCString {
        fstatat(descriptor, $0, &value, AT_SYMLINK_NOFOLLOW)
    }
    if result == 0 { return true }
    if errno == ENOENT { return false }
    throw HelperFailure(code: "DESTINATION_CHECK_FAILED", message: "A destination could not be checked")
}

private func numberedDestination(
    rootDescriptor: Int32,
    desired: String,
    reserved: inout Set<String>
) throws -> String {
    let components = try validatedComponents(desired)
    let originalName = components.last!
    let original = originalName as NSString
    let fileExtension = original.pathExtension
    let stem = fileExtension.isEmpty ? originalName : original.deletingPathExtension

    for number in 0...10_000 {
        let name: String
        if number == 0 {
            name = originalName
        } else if fileExtension.isEmpty {
            name = "\(stem) (\(number))"
        } else {
            name = "\(stem) (\(number)).\(fileExtension)"
        }
        let candidateComponents = Array(components.dropLast()) + [name]
        let candidate = candidateComponents.joined(separator: "/")
        guard candidate.utf8.count <= 2048 else { continue }
        if !reserved.contains(candidate),
           !(try destinationExists(rootDescriptor: rootDescriptor, components: candidateComponents)) {
            reserved.insert(candidate)
            return candidate
        }
    }
    throw HelperFailure(code: "DESTINATION_UNAVAILABLE", message: "A unique destination name could not be generated")
}

private func atomicMove(rootDescriptor: Int32, source: String, destination: String) throws {
    let flags = UInt32(RENAME_EXCL | RENAME_NOFOLLOW_ANY)
    let result = source.withCString { sourcePointer in
        destination.withCString { destinationPointer in
            renameatx_np(rootDescriptor, sourcePointer, rootDescriptor, destinationPointer, flags)
        }
    }
    guard result == 0 else {
        let code: String
        switch errno {
        case EEXIST: code = "DESTINATION_EXISTS"
        case EXDEV: code = "CROSS_VOLUME_MOVE_BLOCKED"
        case ELOOP, ENOTCAPABLE: code = "UNSAFE_PATH"
        case ENOENT: code = "SOURCE_NOT_FOUND"
        default:
#if DEBUG
            code = "MOVE_FAILED_\(errno)"
#else
            code = "MOVE_FAILED"
#endif
        }
        throw HelperFailure(code: code, message: "A Desktop item could not be moved")
    }
}

private func moveItems(_ request: MoveRequest) throws -> MoveResponse {
    guard !request.moves.isEmpty, request.moves.count <= maximumMoves else {
        throw HelperFailure(code: "INVALID_MOVE_COUNT", message: "moves must contain 1 to \(maximumMoves) items")
    }
    return try withAuthorizedDesktop { root in
        let snapshot = try loadSnapshot(request.snapshotId)
        let byPath = Dictionary(uniqueKeysWithValues: snapshot.items.map { ($0.item.relativePath, $0) })
        var seenSources = Set<String>()

        let rootDescriptor = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard rootDescriptor >= 0 else {
            throw HelperFailure(code: "DESKTOP_UNAVAILABLE", message: "Desktop could not be opened")
        }
        defer { close(rootDescriptor) }

        for move in request.moves {
            let sourceComponents = try validatedComponents(move.sourceRelativePath)
            let destinationComponents = try validatedComponents(move.destinationRelativePath)
            guard sourceComponents.count == 1 else {
                throw HelperFailure(code: "SOURCE_NOT_TOP_LEVEL", message: "Only loose files at the first level of Desktop can be moved")
            }
            guard destinationComponents.count == 2 else {
                throw HelperFailure(code: "DESTINATION_NOT_TOP_LEVEL_FOLDER", message: "A destination must be an existing first-level Desktop folder")
            }
            guard destinationComponents[1] == sourceComponents[0] else {
                throw HelperFailure(code: "RENAME_NOT_ALLOWED", message: "move_files cannot rename files")
            }
            guard let source = byPath[move.sourceRelativePath] else {
                throw HelperFailure(code: "SOURCE_NOT_IN_SNAPSHOT", message: "Every source must come from the supplied snapshot")
            }
            guard source.item.itemType == "file" else {
                throw HelperFailure(code: "SOURCE_NOT_LOOSE_FILE", message: "Only loose files can be moved")
            }
            let folderName = destinationComponents[0]
            if let folder = byPath[folderName] {
                guard folder.item.itemType == "folder" else {
                    throw HelperFailure(code: "DESTINATION_FOLDER_NOT_FOUND", message: "The destination must be an existing first-level Desktop folder")
                }
                try verifyCurrentIdentity(rootDescriptor: rootDescriptor, relativePath: folderName, expected: folder)
            } else if folderName != "Default" {
                throw HelperFailure(code: "DESTINATION_FOLDER_NOT_FOUND", message: "The destination must be an existing first-level Desktop folder")
            }
            guard seenSources.insert(move.sourceRelativePath).inserted else {
                throw HelperFailure(code: "DUPLICATE_MOVE", message: "Move sources must be unique")
            }
            try verifyCurrentIdentity(
                rootDescriptor: rootDescriptor,
                relativePath: move.sourceRelativePath,
                expected: source
            )
        }

        var reservedDestinations = Set<String>()
        var resolvedMoves: [MoveInstruction] = []
        for move in request.moves {
            resolvedMoves.append(MoveInstruction(
                sourceRelativePath: move.sourceRelativePath,
                destinationRelativePath: try numberedDestination(
                    rootDescriptor: rootDescriptor,
                    desired: move.destinationRelativePath,
                    reserved: &reservedDestinations
                )
            ))
        }

        guard confirmMoves(resolvedMoves) else {
            return MoveResponse(
                status: "cancelled",
                requestedCount: request.moves.count,
                movedCount: 0,
                failedCount: 0,
                results: []
            )
        }

        var results: [MoveResult] = []
        for move in resolvedMoves {
            do {
                let destinationComponents = try validatedComponents(move.destinationRelativePath)
                try ensureDestinationFolder(rootDescriptor: rootDescriptor, folderName: destinationComponents[0])
                try atomicMove(
                    rootDescriptor: rootDescriptor,
                    source: move.sourceRelativePath,
                    destination: move.destinationRelativePath
                )
                results.append(MoveResult(
                    sourceRelativePath: move.sourceRelativePath,
                    destinationRelativePath: move.destinationRelativePath,
                    status: "moved",
                    errorCode: nil
                ))
            } catch let failure as HelperFailure {
                results.append(MoveResult(
                    sourceRelativePath: move.sourceRelativePath,
                    destinationRelativePath: move.destinationRelativePath,
                    status: "failed",
                    errorCode: failure.code
                ))
            }
        }
        let movedCount = results.filter { $0.status == "moved" }.count
        let failedCount = results.count - movedCount
        return MoveResponse(
            status: failedCount == 0 ? "moved" : (movedCount == 0 ? "failed" : "partial_failure"),
            requestedCount: request.moves.count,
            movedCount: movedCount,
            failedCount: failedCount,
            results: results
        )
    }
}

private func run() throws {
    guard CommandLine.arguments.count == 2 else {
        throw HelperFailure(code: "INVALID_COMMAND", message: "Expected authorize, list, or move")
    }
    switch CommandLine.arguments[1] {
    case "authorize":
        try writeResponse(try authorizeDesktop())
    case "list":
        try writeResponse(try listMetadata(try readRequest(ListRequest.self)))
    case "move":
        try writeResponse(try moveItems(try readRequest(MoveRequest.self)))
    default:
        throw HelperFailure(code: "INVALID_COMMAND", message: "Expected authorize, list, or move")
    }
}

do {
    try run()
} catch let failure as HelperFailure {
    try? writeResponse(ErrorResponse(code: failure.code, message: failure.message))
    exit(1)
} catch {
    try? writeResponse(ErrorResponse(code: "INTERNAL_ERROR", message: "Desktop Helper failed"))
    fputs("Desktop Helper error: \(error)\n", stderr)
    exit(1)
}

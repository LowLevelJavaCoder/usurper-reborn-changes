using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using UsurperRemake.BBS;

namespace UsurperRemake.Systems
{
    /// <summary>
    /// JSON file-based save backend for local and Steam single-player mode.
    /// Saves each game as a JSON file in the user's save directory.
    /// BBS door mode isolates saves per-BBS via subdirectories.
    /// </summary>
    public class FileSaveBackend : ISaveBackend
    {
        private readonly string baseSaveDirectory;
        private readonly JsonSerializerOptions jsonOptions;

        /// <summary>
        /// Get the active save directory (includes BBS namespace if in door mode)
        /// </summary>
        private string SaveDirectory
        {
            get
            {
                var bbsNamespace = DoorMode.GetSaveNamespace();
                if (!string.IsNullOrEmpty(bbsNamespace))
                {
                    var bbsDir = Path.Combine(baseSaveDirectory, bbsNamespace);
                    Directory.CreateDirectory(bbsDir);
                    return bbsDir;
                }
                return baseSaveDirectory;
            }
        }

        public FileSaveBackend()
        {
            baseSaveDirectory = Path.Combine(GetUserDataPath(), "saves");
            Directory.CreateDirectory(baseSaveDirectory);

            jsonOptions = new JsonSerializerOptions
            {
                WriteIndented = true,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                IncludeFields = true
            };
        }

        public async Task<bool> WriteGameData(string playerName, SaveGameData data)
        {
            try
            {
                var fileName = GetSaveFileName(playerName);
                var filePath = Path.Combine(SaveDirectory, fileName);
                // Use stream-based serialization to avoid OOM on large saves
                using var stream = new FileStream(filePath, FileMode.Create, FileAccess.Write, FileShare.None, 8192, true);
                await JsonSerializer.SerializeAsync(stream, data, jsonOptions);
                return true;
            }
            catch (Exception ex)
            {
                DebugLogger.Instance.LogSystemError("SAVE", $"Failed to write game data: {ex.Message}", ex.StackTrace);
                return false;
            }
        }

        public async Task<SaveGameData?> ReadGameData(string playerName)
        {
            try
            {
                var fileName = GetSaveFileName(playerName);
                var filePath = Path.Combine(SaveDirectory, fileName);

                if (!File.Exists(filePath))
                {
                    DebugLogger.Instance.LogDebug("LOAD", $"No save file found for '{playerName}'");
                    return null;
                }

                var json = await File.ReadAllTextAsync(filePath);
                var saveData = JsonSerializer.Deserialize<SaveGameData>(json, jsonOptions);

                if (saveData == null)
                {
                    DebugLogger.Instance.LogError("LOAD", "Failed to deserialize save data");
                    return null;
                }

                if (saveData.Version < GameConfig.MinSaveVersion)
                {
                    DebugLogger.Instance.LogError("LOAD", $"Save file version {saveData.Version} is too old (minimum: {GameConfig.MinSaveVersion})");
                    return null;
                }

                DebugLogger.Instance.LogDebug("LOAD", $"Save file loaded: {fileName} (v{saveData.Version})");
                return saveData;
            }
            catch (Exception ex)
            {
                DebugLogger.Instance.LogSystemError("LOAD", $"Failed to load game: {ex.Message}", ex.StackTrace);
                return null;
            }
        }

        public async Task<SaveGameData?> ReadGameDataByFileName(string fileName)
        {
            var (data, _) = await ReadGameDataByFileNameWithError(fileName);
            return data;
        }

        /// <summary>
        /// v0.57.14: Load-path resilience. Returns the save data on success, or a
        /// specific human-readable error message on failure, so the caller can show
        /// the player what actually went wrong (file missing, disk error, malformed
        /// JSON, OOM on a bloated save, etc.) instead of a generic "corrupted" line.
        /// Error messages also include the file path so the player knows where to
        /// look for manual recovery (backup file, autosaves, text editor).
        /// </summary>
        public async Task<(SaveGameData? Data, string? Error)> ReadGameDataByFileNameWithError(string fileName)
        {
            string filePath = "";
            try
            {
                filePath = Path.Combine(SaveDirectory, fileName);

                if (!File.Exists(filePath))
                {
                    return (null, $"Save file not found on disk: {filePath}");
                }

                var fileInfo = new FileInfo(filePath);
                long fileSizeBytes = fileInfo.Length;

                string json;
                try
                {
                    json = await File.ReadAllTextAsync(filePath);
                }
                catch (OutOfMemoryException)
                {
                    long sizeMB = fileSizeBytes / (1024 * 1024);
                    return (null, $"Save file is too large to load ({sizeMB} MB at {filePath}). This indicates the save has accumulated state unexpectedly. Try the backup file if present.");
                }
                catch (IOException ex)
                {
                    return (null, $"Cannot read save file ({ex.Message}). Path: {filePath}. Another program may have the file open.");
                }
                catch (UnauthorizedAccessException ex)
                {
                    return (null, $"Permission denied reading save file ({ex.Message}). Path: {filePath}.");
                }

                SaveGameData? saveData;
                try
                {
                    saveData = JsonSerializer.Deserialize<SaveGameData>(json, jsonOptions);
                }
                catch (OutOfMemoryException)
                {
                    long sizeMB = fileSizeBytes / (1024 * 1024);
                    return (null, $"Not enough memory to parse save file ({sizeMB} MB at {filePath}). The save contains more data than the process can hold.");
                }
                catch (JsonException ex)
                {
                    return (null, $"Save file has malformed JSON near line {ex.LineNumber}, position {ex.BytePositionInLine} ({ex.Message}). Path: {filePath}.");
                }

                if (saveData == null)
                {
                    return (null, $"Save file deserialized to null (unexpected JSON structure). Path: {filePath}.");
                }

                if (saveData.Version < GameConfig.MinSaveVersion)
                {
                    return (null, $"Save file version {saveData.Version} is older than the minimum supported version {GameConfig.MinSaveVersion}. Path: {filePath}.");
                }

                return (saveData, null);
            }
            catch (Exception ex)
            {
                DebugLogger.Instance.LogError("SAVE", $"Unexpected error loading '{fileName}': {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
                return (null, $"Unexpected error loading save ({ex.GetType().Name}: {ex.Message}). Path: {filePath}.");
            }
        }

        public bool GameDataExists(string playerName)
        {
            var fileName = GetSaveFileName(playerName);
            var filePath = Path.Combine(SaveDirectory, fileName);
            return File.Exists(filePath);
        }

        public bool DeleteGameData(string playerName)
        {
            try
            {
                var fileName = GetSaveFileName(playerName);
                var filePath = Path.Combine(SaveDirectory, fileName);

                if (File.Exists(filePath))
                {
                    File.Delete(filePath);
                    return true;
                }

                return false;
            }
            catch (Exception ex)
            {
                return false;
            }
        }

        public List<SaveInfo> GetAllSaves()
        {
            var saves = new List<SaveInfo>();

            try
            {
                var files = Directory.GetFiles(SaveDirectory, "*.json");

                foreach (var file in files)
                {
                    string fileName = Path.GetFileName(file);

                    // v0.57.13: skip obvious non-character files (autosaves, backups,
                    // emergency dumps). These aren't meant to appear in the load-save list.
                    // The primary save is the untimestamped `<Name>.json` — that's what we
                    // list; backups/autosaves remain on disk as recovery copies.
                    if (fileName.Contains("_autosave") ||
                        fileName.Contains("_backup") ||
                        fileName.StartsWith("emergency_"))
                    {
                        continue;
                    }

                    // v0.57.13: resilient listing. Previously, any exception during
                    // File.ReadAllText or JsonSerializer.Deserialize swallowed the save
                    // silently, so a single bloated/corrupt file (e.g. 73MB accumulated
                    // state that OOM'd the deserialize) removed the save from the load
                    // list even though the file is intact on disk. Now: try the full
                    // deserialize first; on ANY failure, fall back to filename-based
                    // metadata so the player can still see and load the save.
                    try
                    {
                        var json = File.ReadAllText(file);
                        var saveData = JsonSerializer.Deserialize<SaveGameData>(json, jsonOptions);

                        if (saveData?.Player != null)
                        {
                            saves.Add(new SaveInfo
                            {
                                PlayerName = saveData.Player.Name2 ?? saveData.Player.Name1,
                                SaveTime = saveData.SaveTime,
                                Level = saveData.Player.Level,
                                CurrentDay = saveData.CurrentDay,
                                TurnsRemaining = saveData.Player.TurnsRemaining,
                                FileName = fileName
                            });
                            continue;
                        }
                        // Deserialized but no Player — treat as unrecognised, fall through.
                    }
                    catch (Exception ex)
                    {
                        DebugLogger.Instance.LogWarning("SAVE", $"Could not parse '{fileName}' ({ex.GetType().Name}: {ex.Message}). Listing with filename-only metadata so player can still load it.");
                    }

                    // Fallback: save file exists but can't be fully deserialised. Use
                    // filename + file metadata so the slot is at least visible.
                    try
                    {
                        var info = new FileInfo(file);
                        var nameFromFile = Path.GetFileNameWithoutExtension(file);
                        saves.Add(new SaveInfo
                        {
                            PlayerName = nameFromFile,
                            SaveTime = info.LastWriteTime,
                            Level = 0,
                            CurrentDay = 0,
                            TurnsRemaining = 0,
                            FileName = fileName
                        });
                    }
                    catch (Exception ex2)
                    {
                        DebugLogger.Instance.LogError("SAVE", $"Fallback metadata read failed for '{fileName}': {ex2.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                DebugLogger.Instance.LogError("SAVE", $"GetAllSaves enumeration failed: {ex.Message}");
            }

            return saves;
        }

        public List<SaveInfo> GetPlayerSaves(string playerName)
        {
            var saves = new List<SaveInfo>();
            var sanitizedName = string.Join("_", playerName.Split(Path.GetInvalidFileNameChars()));

            try
            {
                var pattern = $"{sanitizedName}*.json";
                var files = Directory.GetFiles(SaveDirectory, pattern);

                foreach (var file in files)
                {
                    try
                    {
                        var json = File.ReadAllText(file);
                        var saveData = JsonSerializer.Deserialize<SaveGameData>(json, jsonOptions);

                        if (saveData?.Player != null)
                        {
                            var fileName = Path.GetFileName(file);
                            var isAutosave = fileName.Contains("_autosave_");

                            saves.Add(new SaveInfo
                            {
                                PlayerName = saveData.Player.Name2 ?? saveData.Player.Name1,
                                ClassName = saveData.Player.Class.ToString(),
                                SaveTime = saveData.SaveTime,
                                Level = saveData.Player.Level,
                                CurrentDay = saveData.CurrentDay,
                                TurnsRemaining = saveData.Player.TurnsRemaining,
                                FileName = fileName,
                                IsAutosave = isAutosave,
                                SaveType = isAutosave ? "Autosave" : "Manual Save"
                            });
                        }
                    }
                    catch (Exception ex)
            {
                DebugLogger.Instance.Log(DebugLogger.LogLevel.Debug, "SYSTEM", $"Swallowed exception: {ex.Message}");
            }
                }

                saves = saves.OrderByDescending(s => s.SaveTime).ToList();
            }
            catch (Exception ex)
            {
                DebugLogger.Instance.Log(DebugLogger.LogLevel.Debug, "SYSTEM", $"Swallowed exception: {ex.Message}");
            }

            return saves;
        }

        public SaveInfo? GetMostRecentSave(string playerName)
        {
            var saves = GetPlayerSaves(playerName);
            return saves.FirstOrDefault();
        }

        public List<string> GetAllPlayerNames()
        {
            var playerNames = new HashSet<string>();

            try
            {
                var files = Directory.GetFiles(SaveDirectory, "*.json");

                foreach (var file in files)
                {
                    try
                    {
                        var json = File.ReadAllText(file);
                        var saveData = JsonSerializer.Deserialize<SaveGameData>(json, jsonOptions);

                        if (saveData?.Player != null)
                        {
                            var playerName = saveData.Player.Name2 ?? saveData.Player.Name1;
                            if (!string.IsNullOrWhiteSpace(playerName))
                            {
                                playerNames.Add(playerName);
                            }
                        }
                    }
                    catch
                    {
                        // Skip invalid save files
                    }
                }
            }
            catch (Exception ex)
            {
                DebugLogger.Instance.Log(DebugLogger.LogLevel.Debug, "SYSTEM", $"Swallowed exception: {ex.Message}");
            }

            return playerNames.OrderBy(n => n).ToList();
        }

        public bool IsDisplayNameTaken(string displayName, string excludeUsername)
        {
            // Single-player file saves don't need duplicate display name checks
            return false;
        }

        public async Task<bool> WriteAutoSave(string playerName, SaveGameData data)
        {
            var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
            var autosaveName = $"{playerName}_autosave_{timestamp}";

            var success = await WriteGameData(autosaveName, data);

            if (success)
            {
                RotateAutosaves(playerName);
            }

            return success;
        }

        public void CreateBackup(string playerName)
        {
            try
            {
                var fileName = GetSaveFileName(playerName);
                var filePath = Path.Combine(SaveDirectory, fileName);

                if (File.Exists(filePath))
                {
                    var backupPath = Path.Combine(SaveDirectory, $"{Path.GetFileNameWithoutExtension(fileName)}_backup.json");
                    File.Copy(filePath, backupPath, true);
                }
            }
            catch (Exception ex)
            {
                DebugLogger.Instance.Log(DebugLogger.LogLevel.Debug, "SYSTEM", $"Swallowed exception: {ex.Message}");
            }
        }

        public string GetSaveDirectory() => SaveDirectory;

        private string GetSaveFileName(string playerName)
        {
            var sanitized = string.Join("_", playerName.Split(Path.GetInvalidFileNameChars()));
            return $"{sanitized}.json";
        }

        private void RotateAutosaves(string playerName)
        {
            try
            {
                var autosavePattern = $"{string.Join("_", playerName.Split(Path.GetInvalidFileNameChars()))}_autosave_*.json";
                var autosaveFiles = Directory.GetFiles(SaveDirectory, autosavePattern);

                var sortedFiles = autosaveFiles
                    .Select(f => new FileInfo(f))
                    .OrderByDescending(f => f.CreationTime)
                    .ToList();

                for (int i = 5; i < sortedFiles.Count; i++)
                {
                    sortedFiles[i].Delete();
                }
            }
            catch (Exception ex)
            {
                DebugLogger.Instance.Log(DebugLogger.LogLevel.Debug, "SYSTEM", $"Swallowed exception: {ex.Message}");
            }
        }

        private string GetUserDataPath()
        {
            var appName = "UsurperReloaded";

            if (System.Environment.OSVersion.Platform == PlatformID.Win32NT)
            {
                return Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.ApplicationData), appName);
            }
            else if (System.Environment.OSVersion.Platform == PlatformID.Unix)
            {
                var home = System.Environment.GetEnvironmentVariable("HOME");
                return Path.Combine(home ?? "/tmp", ".local", "share", appName);
            }
            else
            {
                var home = System.Environment.GetEnvironmentVariable("HOME");
                return Path.Combine(home ?? "/tmp", "Library", "Application Support", appName);
            }
        }
    }
}

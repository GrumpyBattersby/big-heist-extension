using System;
using System.Net.Http;
using System.Text;
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json;

public class CPHInline
{
    private static readonly string[] SkillNames = {
        "Forger", "Demolitions", "Driver", "Medic", "Muscle", "Hacker", "Surveillance",
        "Mastermind", "Negotiator", "Bluff", "Safecracking", "SmallWeapons",
        "LargeWeapons", "Disguise", "Acrobatics", "Pickpocket", "Robbery",
        "Investigation", "Capture"
    };

    private static readonly HttpClient httpClient = new HttpClient();

    public bool Execute()
    {
        // ============================
        // CONFIGURE THESE TWO VALUES
        // ============================
        string backendUrl = "https://big-heist-backend.onrender.com";
        string pushSecret = "heist-secret-7f3k9x2m";

        CPH.TryGetArg("userId", out string userId);
        if (string.IsNullOrEmpty(userId)) return true;

        try
        {
            // Gather current name, inventory, and skills fresh from persisted vars
            string perpJson = CPH.GetGlobalVar<string>("PerpData");
            var perps = string.IsNullOrEmpty(perpJson)
                ? new Dictionary<string, Dictionary<string, object>>()
                : JsonConvert.DeserializeObject<Dictionary<string, Dictionary<string, object>>>(perpJson);

            string name = perps.ContainsKey(userId) && perps[userId].ContainsKey("name")
                ? perps[userId]["name"].ToString() : userId;

            string lastCrime = "";
            if (perps.ContainsKey(userId) && perps[userId].ContainsKey("criminalRecord"))
            {
                var record = JsonConvert.DeserializeObject<List<string>>(perps[userId]["criminalRecord"].ToString());
                if (record != null && record.Count > 0) lastCrime = record[record.Count - 1];
            }

            // Matches Heist - Update PerpCard's exact priority logic: an active jail sentence
            // (tracked separately in ActiveBigHeistCubes) overrides crimeStatus entirely
            string crimeStatus = "CITIZEN";
            string cubesJson = CPH.GetGlobalVar<string>("ActiveBigHeistCubes");
            var cubes = string.IsNullOrEmpty(cubesJson)
                ? new Dictionary<string, long>()
                : JsonConvert.DeserializeObject<Dictionary<string, long>>(cubesJson);

            if (cubes.ContainsKey(userId) && cubes[userId] > 0)
            {
                long minutesLeft = cubes[userId] / 60;
                crimeStatus = "ISOCUBE #" + minutesLeft;
            }
            else
            {
                string rawCrimeStatus = CPH.GetTwitchUserVarById<string>(userId, "crimeStatus", true);
                if (!string.IsNullOrEmpty(rawCrimeStatus)) crimeStatus = rawCrimeStatus;
            }

            string achievementsJson = CPH.GetTwitchUserVarById<string>(userId, "achievements", true);
            var achievementsRaw = string.IsNullOrEmpty(achievementsJson)
                ? new Dictionary<string, object>()
                : JsonConvert.DeserializeObject<Dictionary<string, object>>(achievementsJson);
            var unlockedAchievements = new List<string>();
            foreach (var kv in achievementsRaw)
            {
                if (kv.Value is bool && (bool)kv.Value) unlockedAchievements.Add(kv.Key);
                else if (kv.Value.ToString().Equals("true", StringComparison.OrdinalIgnoreCase)) unlockedAchievements.Add(kv.Key);
            }

            string pendingPickStr = CPH.GetTwitchUserVarById<string>(userId, "pendingMugshotPick", true);
            bool pendingMugshotPick = pendingPickStr != null && pendingPickStr.Equals("true", StringComparison.OrdinalIgnoreCase);

            string invJson = CPH.GetTwitchUserVarById<string>(userId, "heist_inventory", true);
            var inventory = string.IsNullOrEmpty(invJson)
                ? new Dictionary<string, int>()
                : JsonConvert.DeserializeObject<Dictionary<string, int>>(invJson);

            var skills = new Dictionary<string, int>();
            foreach (string skill in SkillNames)
            {
                int val = CPH.GetTwitchUserVarById<int>(userId, "skill_" + skill, true);
                if (val > 0) skills[skill] = val;
            }

            var payload = new
            {
                userId = userId,
                name = name,
                inventory = inventory,
                skills = skills,
                lastCrime = lastCrime,
                crimeStatus = crimeStatus,
                achievements = unlockedAchievements,
                pendingMugshotPick = pendingMugshotPick
            };

            string json = JsonConvert.SerializeObject(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var request = new HttpRequestMessage(HttpMethod.Post, backendUrl + "/api/push-data");
            request.Headers.Add("X-Push-Secret", pushSecret);
            request.Content = content;

            // Blocks briefly until the request actually completes - a "fire and forget" Task.Run here
            // risked being abandoned before it finished, since Streamer.bot's script execution context
            // doesn't guarantee background tasks survive after Execute() returns.
            try
            {
                var response = httpClient.SendAsync(request).GetAwaiter().GetResult();
                if (!response.IsSuccessStatusCode)
                {
                    CPH.LogWarn("Sync to Extension: backend responded with " + response.StatusCode);
                }
            }
            catch (Exception ex)
            {
                CPH.LogWarn("Sync to Extension failed: " + ex.Message);
            }
        }
        catch (Exception ex)
        {
            CPH.LogWarn("Sync to Extension failed to build payload: " + ex.Message);
        }

        return true;
    }
}

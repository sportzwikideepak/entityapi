require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const db = require("./config/db");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(helmet());
app.use(cors());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100, // Limit each IP to 100 requests per 15 minutes
  })
);

app.get("/matches/:status", async (req, res) => {
  try {
    const { status } = req.params;
    let { per_page = 80, page = 1 } = req.query;

    per_page = parseInt(per_page) || 80;
    page = Math.max(parseInt(page) || 1, 1);
    const offset = (page - 1) * per_page;

    let statusCondition = "";
    let orderBy = "";

    if (status === "upcoming") {
      statusCondition = "matches.match_status_id = 1 AND matches.date_start >= NOW()";
      orderBy = "matches.date_start ASC"; // Upcoming: Nearest matches first
    } else if (status === "live") {
      statusCondition = "matches.match_status_id = 3";
      orderBy = "matches.date_start DESC"; // Live: Latest live matches first
    } else if (status === "completed") {
      statusCondition = "matches.match_status_id = 2 AND matches.date_start <= NOW()";
      orderBy = "matches.date_start DESC"; // Completed: Most recent matches first
    } else {
      return res.status(400).json({ message: "Invalid status. Use upcoming, live, or completed." });
    }

    // ✅ Fetch the matches
    const query = `
      SELECT 
        matches.id AS match_id, 
        matches.api_id AS api_id,
        matches.name AS title, 
        matches.date_start, 
        matches.match_status_id,
        t1.id AS teamA_id, t1.name AS teamA_name, t1.short_name AS teamA_short, 
        t1.logo_url AS teamA_logo,
        t2.id AS teamB_id, t2.name AS teamB_name, t2.short_name AS teamB_short, 
        t2.logo_url AS teamB_logo,
        venues.id AS venue_id, venues.name AS venue_name, venues.city AS venue_city, venues.country AS venue_country,
        competitions.id AS competition_id, competitions.name AS competition_name, competitions.abbr AS competition_abbr, 
        match_categories.id AS match_category_id, match_categories.name AS match_category_name
      FROM matches
      JOIN teams t1 ON matches.team_1 = t1.id
      JOIN teams t2 ON matches.team_2 = t2.id
      JOIN venues ON matches.venue_id = venues.id
      LEFT JOIN competitions ON matches.competition_id = competitions.id
      LEFT JOIN match_categories ON competitions.match_category_id = match_categories.id
      WHERE ${statusCondition}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?;
    `;

    console.log("🔹 Executing Query:", query);
    console.log("🔹 Status:", status);
    console.log("🔹 Limit:", per_page, "Offset:", offset);

    const [matches] = await db.execute(query, [per_page, offset]);

    console.log("🔹 Matches Found:", matches.length);

    // ✅ Count Query for Pagination
    const countQuery = `
      SELECT COUNT(*) AS total 
      FROM matches 
      WHERE ${statusCondition};
    `;
    const [countResult] = await db.execute(countQuery);
    const totalMatches = countResult[0].total;
    const totalPages = Math.ceil(totalMatches / per_page);

    res.json({
      total_matches: totalMatches,
      per_page,
      page,
      total_pages: totalPages,
      matches: matches,
    });

  } catch (error) {
    console.error("❌ Error fetching matches:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});







// ✅ Fetch a Single  Match id
// app.get("/match/:match_id", async (req, res) => {
//   try {
//     const { match_id } = req.params;

//     const query = `
//       SELECT 
//         m.id AS match_id, 
//         m.name AS title, 
//         m.date_start, 
//         m.match_status_id, 
//         m.weather,
//         t1.id AS teamA_id, 
//         t1.name AS teamA_name, 
//         t1.short_name AS teamA_short, 
//         t1.slug AS teamA_slug, 
//         t1.logo_url AS teamA_logo,  -- ✅ Fetch Team A Logo
//         t2.id AS teamB_id, 
//         t2.name AS teamB_name, 
//         t2.short_name AS teamB_short, 
//         t2.slug AS teamB_slug, 
//         t2.logo_url AS teamB_logo,  -- ✅ Fetch Team B Logo
//         v.id AS venue_id, 
//         v.name AS venue_name, 
//         v.city AS venue_city, 
//         v.country AS venue_country
//       FROM matches m
//       JOIN teams t1 ON m.team_1 = t1.id
//       JOIN teams t2 ON m.team_2 = t2.id
//       JOIN venues v ON m.venue_id = v.id
//       WHERE m.api_id = ?
//     `;

//     const [match] = await db.execute(query, [match_id]);

//     if (match.length === 0) {
//       return res.status(404).json({ message: "Match not found" });
//     }

//     res.json(match[0]);
//   } catch (error) {
//     console.error("❌ Error fetching match details:", error.message);
//     res.status(500).json({ message: "Server error" });
//   }
// });

app.get("/match/:match_id", async (req, res) => {
  try {
    const { match_id } = req.params;

    // Fetch match details including venue information
    const matchQuery = `
      SELECT 
        m.id AS match_id, 
        m.api_id, 
        m.name AS title, 
        m.date_start, 
        m.match_status_id, 
        m.weather,
        m.format_str,  
        m.competition_id,
        c.name AS competition_name,
        c.type AS competition_type,

        t1.id AS teamA_id, 
        t1.name AS teamA_name, 
        t1.short_name AS teamA_short,  
        t1.logo_url AS teamA_logo, 

        t2.id AS teamB_id, 
        t2.name AS teamB_name, 
        t2.short_name AS teamB_short,  
        t2.logo_url AS teamB_logo, 
        
        v.id AS venue_id,
        v.name AS venue_name,
        v.city AS venue_city,
        v.country AS venue_country,
        v.capacity AS venue_capacity  /* ADDED Venue Details */

      FROM matches m
      JOIN teams t1 ON m.team_1 = t1.id
      JOIN teams t2 ON m.team_2 = t2.id
      LEFT JOIN competitions c ON m.competition_id = c.id
      LEFT JOIN venues v ON m.venue_id = v.id  /* ADDED Venue Join */
      WHERE m.api_id = ?
    `;

    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (matchResult.length === 0) {
      return res.status(404).json({ message: "Match not found" });
    }

    const matchData = matchResult[0];

    // Fetch innings data using match_id from match_innings table
    const inningsQuery = `
      SELECT 
        mi.batting_team_id, 
        t.id AS team_id, 
        t.name AS team_name, 
        t.short_name AS team_short,  
        t.logo_url AS team_logo, 
        mi.number AS innings_number,  
        mi.scores_full AS scores_full,  
        mi.scores AS scores,  
        mi.score_runs AS score_runs  

      FROM match_innings mi
      LEFT JOIN teams t ON mi.batting_team_id = t.id 
      WHERE mi.match_id = ?
    `;

    const [inningsResult] = await db.execute(inningsQuery, [matchData.match_id]);

    // Function to fix logo URLs if needed
    const fixLogoURL = (url) => {
      if (!url) return null; // If URL is null, return null
      return url.startsWith("http") ? url : `https://cricketaddictor.com${url}`;
    };

    // Build response
    const match = {
      match_id: matchData.match_id,
      api_id: matchData.api_id,
      title: matchData.title,
      date_start: matchData.date_start,
      match_status_id: matchData.match_status_id,
      weather: matchData.weather,
      format_str: matchData.format_str,
      competition_id: matchData.competition_id,
      competition_name: matchData.competition_name,
      competition_type: matchData.competition_type,

      teamA_id: matchData.teamA_id,
      teamA_name: matchData.teamA_name,
      teamA_short: matchData.teamA_short,  
      teamA_logo: fixLogoURL(matchData.teamA_logo), 

      teamB_id: matchData.teamB_id,
      teamB_name: matchData.teamB_name,
      teamB_short: matchData.teamB_short,  
      teamB_logo: fixLogoURL(matchData.teamB_logo), 

      venue: {
        venue_id: matchData.venue_id,
        venue_name: matchData.venue_name,
        venue_city: matchData.venue_city,
        venue_country: matchData.venue_country,
        venue_capacity: matchData.venue_capacity
      },

      innings: inningsResult.map(row => ({
        batting_team_id: row.team_id, 
        team_name: row.team_name, 
        team_short: row.team_short,  
        team_logo: fixLogoURL(row.team_logo), 
        innings_number: row.innings_number,
        scores_full: row.scores_full,
        scores: row.scores,
        score_runs: row.score_runs,
      }))
    };

    res.json(match);
  } catch (error) {
    console.error("❌ Error fetching match details:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});











// ✅ Fetch Live Scores for Ongoing Matches with Pagination
app.get("/matches/live/scores", async (req, res) => {
  try {
    let { per_page = 80, page = 1 } = req.query;

    per_page = parseInt(per_page);
    page = parseInt(page);
    if (isNaN(per_page) || per_page <= 0) per_page = 80;
    if (isNaN(page) || page <= 0) page = 1;

    const offset = (page - 1) * per_page;

    const query = `
      SELECT 
        m.id AS match_id, m.name AS title, m.date_start, 
        t1.name AS teamA_name, t1.short_name AS teamA_short, t1.slug AS teamA_slug,
        t2.name AS teamB_name, t2.short_name AS teamB_short, t2.slug AS teamB_slug
      FROM matches m
      JOIN teams t1 ON m.team_1 = t1.id
      JOIN teams t2 ON m.team_2 = t2.id
      WHERE m.match_status_id = 3
      LIMIT ${per_page} OFFSET ${offset}
    `;

    const [scores] = await db.execute(query);

    const countQuery = `SELECT COUNT(*) AS total FROM matches WHERE match_status_id = 3`;
    const [countResult] = await db.execute(countQuery);
    const totalMatches = countResult[0].total;
    const totalPages = Math.ceil(totalMatches / per_page);

    res.json({
      total_matches: totalMatches,
      per_page,
      page,
      total_pages: totalPages,
      scores,
    });
  } catch (error) {
    console.error("❌ Error fetching live scores:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

//FETCH MATCH SCORECARD
app.get("/match/:match_id/scorecard", async (req, res) => {
  try {
    const { match_id } = req.params;

    // 🔹 Fetch Match Details
    const matchQuery = `
      SELECT 
        m.id AS match_id, m.name AS match_title, 
        t1.id AS teamA_id, t1.name AS teamA_name, t1.short_name AS teamA_short, t1.logo_url AS teamA_logo,
        t2.id AS teamB_id, t2.name AS teamB_name, t2.short_name AS teamB_short, t2.logo_url AS teamB_logo
      FROM matches m
      JOIN teams t1 ON m.team_1 = t1.id
      JOIN teams t2 ON m.team_2 = t2.id
      WHERE m.id = ?
    `;
    const [matchData] = await db.execute(matchQuery, [match_id]);

    if (matchData.length === 0) {
      return res.status(404).json({ message: "Match not found" });
    }

    // 🔹 Fetch Innings Data
    const inningsQuery = `
      SELECT 
        i.id AS inning_id, i.number AS inning_number, i.batting_team_id, 
        t.name AS team_name, i.scores, i.score_runs, i.scores_full
      FROM match_innings i
      JOIN teams t ON i.batting_team_id = t.id
      WHERE i.match_id = ?
      ORDER BY i.number
    `;
    const [inningsData] = await db.execute(inningsQuery, [match_id]);

    // 🔹 Fetch Batting Data from `match_inning_batters`
    const battingQuery = `
      SELECT 
        b.id AS batting_id, b.match_inning_id, p.first_name, p.last_name, 
        b.runs, b.balls_faced AS balls, b.fours, b.sixes, b.strike_rate, 
        b.how_out, p.image AS player_image
      FROM match_inning_batters b
      JOIN players p ON b.batsman_id = p.id
      WHERE b.match_inning_id IN (SELECT id FROM match_innings WHERE match_id = ?)
      ORDER BY b.match_inning_id, b.id
    `;
    const [battingData] = await db.execute(battingQuery, [match_id]);

    // 🔹 Fetch Bowling Data from `match_inning_bowlers`
    const bowlingQuery = `
      SELECT 
        bo.id AS bowling_id, bo.match_inning_id, p.first_name, p.last_name, 
        bo.overs, bo.runs_conceded AS runs, bo.wickets, bo.econ AS economy, 
        p.image AS player_image
      FROM match_inning_bowlers bo
      JOIN players p ON bo.bowler_id = p.id
      WHERE bo.match_inning_id IN (SELECT id FROM match_innings WHERE match_id = ?)
      ORDER BY bo.match_inning_id, bo.id
    `;
    const [bowlingData] = await db.execute(bowlingQuery, [match_id]);

    // 🔹 Fetch Fall of Wicket Data from `match_inning_fows`
    const fowQuery = `
      SELECT 
        f.match_inning_id, p.first_name, p.last_name, f.runs, f.balls, 
        f.how_out, f.score_at_dismissal, f.overs_at_dismissal
      FROM match_inning_fows f
      JOIN players p ON f.batsman_id = p.id
      WHERE f.match_inning_id IN (SELECT id FROM match_innings WHERE match_id = ?)
      ORDER BY f.match_inning_id, f.number
    `;
    const [fowData] = await db.execute(fowQuery, [match_id]);

    // 🔹 Structure Response
    const innings = inningsData.map((inning) => ({
      inning_number: inning.inning_number,
      team_name: inning.team_name,
      scores: inning.scores,
      runs: inning.score_runs,
      scores_full: inning.scores_full,
      batting: battingData
        .filter((b) => b.match_inning_id === inning.inning_id)
        .map((b) => ({
          player_name: `${b.first_name} ${b.last_name}`,
          runs: b.runs,
          balls: b.balls,
          fours: b.fours,
          sixes: b.sixes,
          strike_rate: b.strike_rate,
          how_out: b.how_out,
          player_image: b.player_image,
        })),
      bowling: bowlingData
        .filter((b) => b.match_inning_id === inning.inning_id)
        .map((b) => ({
          player_name: `${b.first_name} ${b.last_name}`,
          overs: b.overs,
          runs: b.runs,
          wickets: b.wickets,
          economy: b.economy,
          player_image: b.player_image,
        })),
      fall_of_wickets: fowData
        .filter((f) => f.match_inning_id === inning.inning_id)
        .map((f) => ({
          player_name: `${f.first_name} ${f.last_name}`,
          runs: f.runs,
          balls: f.balls,
          how_out: f.how_out,
          score_at_dismissal: f.score_at_dismissal,
          overs_at_dismissal: f.overs_at_dismissal,
        })),
    }));

    res.json({
      match_id: matchData[0].match_id,
      match_title: matchData[0].match_title,
      teams: {
        teamA: {
          id: matchData[0].teamA_id,
          name: matchData[0].teamA_name,
          short_name: matchData[0].teamA_short,
          logo_url: matchData[0].teamA_logo,
        },
        teamB: {
          id: matchData[0].teamB_id,
          name: matchData[0].teamB_name,
          short_name: matchData[0].teamB_short,
          logo_url: matchData[0].teamB_logo,
        },
      },
      innings,
    });
  } catch (error) {
    console.error("❌ Error fetching scorecard:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/match/:match_id/squads", async (req, res) => {
  try {
    const { match_id } = req.params;

    // 🔹 Fetch match details using api_id instead of match_id
    const matchQuery = `
      SELECT m.id AS match_id, m.api_id, 
             t1.id AS teamA_id, t1.name AS teamA_name, 
             t1.short_name AS teamA_short, t1.logo_url AS teamA_logo,
             t2.id AS teamB_id, t2.name AS teamB_name, 
             t2.short_name AS teamB_short, t2.logo_url AS teamB_logo
      FROM matches m
      JOIN teams t1 ON m.team_1 = t1.id
      JOIN teams t2 ON m.team_2 = t2.id
      WHERE m.api_id = ?  /* 🔹 Change to api_id */
    `;

    const [matchData] = await db.execute(matchQuery, [match_id]);

    if (matchData.length === 0) {
      return res.status(404).json({ message: "Match not found" });
    }

    const match_id_actual = matchData[0].match_id; // Get the actual match_id
    const teamA_id = matchData[0].teamA_id;
    const teamB_id = matchData[0].teamB_id;

    // 🔹 Fetch Squad from `match_squads` using the fetched match_id
    const squadQuery = `
      SELECT ms.team_id, p.id AS player_id, p.first_name, p.last_name, 
             p.short_name, p.playing_role, p.image, ms.playing11, ms.role_str
      FROM match_squads ms
      JOIN players p ON ms.player_id = p.id
      WHERE ms.match_id = ?
      ORDER BY ms.team_id, ms.ordering, p.id
    `;

    const [squadData] = await db.execute(squadQuery, [match_id_actual]);

    if (squadData.length === 0) {
      return res.status(404).json({ message: "No players found in squads" });
    }

    // 🔹 Structure Response
    const teamA_squad = squadData
      .filter((player) => player.team_id === teamA_id)
      .map((p) => ({
        player_id: p.player_id,
        first_name: p.first_name,
        last_name: p.last_name,
        short_name: p.short_name,
        playing_role: p.playing_role,
        role_str: p.role_str,
        playing11: p.playing11 === "1" ? true : false,
        image: p.image,
      }));

    const teamB_squad = squadData
      .filter((player) => player.team_id === teamB_id)
      .map((p) => ({
        player_id: p.player_id,
        first_name: p.first_name,
        last_name: p.last_name,
        short_name: p.short_name,
        playing_role: p.playing_role,
        role_str: p.role_str,
        playing11: p.playing11 === "1" ? true : false,
        image: p.image,
      }));

    res.json({
      match_id: match_id_actual,  // Send actual match_id
      api_id: match_id,  // Send api_id in response
      teams: {
        teamA: {
          id: teamA_id,
          name: matchData[0].teamA_name,
          short_name: matchData[0].teamA_short,
          logo_url: matchData[0].teamA_logo,
          squad: teamA_squad,
        },
        teamB: {
          id: teamB_id,
          name: matchData[0].teamB_name,
          short_name: matchData[0].teamB_short,
          logo_url: matchData[0].teamB_logo,
          squad: teamB_squad,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error fetching squads:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});



// WIN PERCNTAGEG BETWEEN TWO TEAMS LAST 5 MATCHES HOME OVERVIEW PAEG
// GET http://localhost:5000/team-comparison?teamA=1&teamB=2

app.get("/team-comparison", async (req, res) => {
  try {
    const { teamA, teamB } = req.query;

    if (!teamA || !teamB) {
      return res
        .status(400)
        .json({ message: "Both teamA and teamB parameters are required" });
    }

    // ✅ SQL Query
    const query = `
          WITH last_matches AS (
              SELECT m.id, 
                     CASE WHEN m.team_1 = ? THEN m.team_1 ELSE m.team_2 END AS team_id, 
                     CASE WHEN m.team_1 = ? THEN m.team_2 ELSE m.team_1 END AS opponent_id, 
                     m.winning_team_id
              FROM matches m
              WHERE (m.team_1 = ? OR m.team_2 = ?)  
                AND m.match_status_id = 2
              ORDER BY m.date_start DESC
              LIMIT 5
          ), 
          
          last_matches_B AS (
              SELECT m.id, 
                     CASE WHEN m.team_1 = ? THEN m.team_1 ELSE m.team_2 END AS team_id, 
                     CASE WHEN m.team_1 = ? THEN m.team_2 ELSE m.team_1 END AS opponent_id, 
                     m.winning_team_id
              FROM matches m
              WHERE (m.team_1 = ? OR m.team_2 = ?)  
                AND m.match_status_id = 2
              ORDER BY m.date_start DESC
              LIMIT 5
          )

          SELECT 
              t.id AS team_id,
              t.name AS team_name,
              COUNT(*) AS total_matches,
              SUM(CASE WHEN c.team_id = c.winning_team_id THEN 1 ELSE 0 END) AS wins,
              ROUND((SUM(CASE WHEN c.team_id = c.winning_team_id THEN 1 ELSE 0 END) * 100.0 / COUNT(*))) AS win_percentage,
              GROUP_CONCAT(
                  CASE 
                      WHEN c.team_id = c.winning_team_id THEN 'W' 
                      ELSE 'L' 
                  END 
                  ORDER BY c.id DESC SEPARATOR ', '
              ) AS recent_form
          FROM (
              SELECT * FROM last_matches
              UNION ALL
              SELECT * FROM last_matches_B
          ) AS c
          JOIN teams t ON c.team_id = t.id
          WHERE c.team_id IN (?, ?)  
          GROUP BY t.id, t.name;
      `;

    const [results] = await db.execute(query, [
      teamA,
      teamA,
      teamA,
      teamA,
      teamB,
      teamB,
      teamB,
      teamB,
      teamA,
      teamB,
    ]);

    res.json(results);
  } catch (error) {
    console.error("❌ Error fetching team comparison data:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// KEY PREDICTION GROUND CONDITION

//ground condition

app.get("/ground-conditions", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    // ✅ SQL Query
    const query = `
          WITH venue_info AS (
              SELECT v.id AS venue_id, v.name AS venue_name
              FROM matches m
              JOIN venues v ON m.venue_id = v.id
              WHERE m.api_id = ?
          ),

          last_5_matches AS (
              SELECT mi.id, mi.score_runs
              FROM match_innings mi
              WHERE mi.match_id IN (
                  SELECT api_id FROM matches WHERE venue_id = (SELECT venue_id FROM venue_info)
              )
              ORDER BY mi.created_at DESC
              LIMIT 5
          )

          SELECT 
              (SELECT venue_id FROM venue_info) AS venue_id,
              (SELECT venue_name FROM venue_info) AS venue_name,
              ROUND(AVG(score_runs)) AS avg_score,
              ROUND(AVG(score_runs / 10)) AS avg_wickets,
              SUM(CASE WHEN score_runs < 140 THEN 1 ELSE 0 END) AS matches_below_140,
              SUM(CASE WHEN score_runs >= 180 THEN 1 ELSE 0 END) AS matches_above_180
          FROM last_5_matches;
      `;

    const [results] = await db.execute(query, [match_id]);

    if (results.length === 0) {
      return res
        .status(404)
        .json({ message: "No data found for this match_id" });
    }

    res.json(results[0]);
  } catch (error) {
    console.error("❌ Error fetching ground conditions:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// toss trend
app.get("/toss-trends", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    const query = `
          WITH venue_info AS (
              SELECT v.id AS venue_id, v.name AS venue_name
              FROM venues v
              JOIN matches m ON m.venue_id = v.id
              WHERE m.api_id = ?
          ),

          toss_decisions AS (
              SELECT 
                  m.id, 
                  JSON_UNQUOTE(JSON_EXTRACT(m.toss, '$.decision')) AS toss_decision, -- Extracts '1' (bat) or '2' (field)
                  JSON_UNQUOTE(JSON_EXTRACT(m.toss, '$.winner')) AS toss_winner, -- Extract Toss Winner Team ID
                  m.winning_team_id, 
                  m.team_1, 
                  m.team_2
              FROM matches m
              WHERE m.venue_id = (SELECT venue_id FROM venue_info)
              AND m.toss IS NOT NULL
              AND m.winning_team_id IS NOT NULL -- ✅ Ensures match result exists
              ORDER BY m.date_start DESC
              LIMIT 5
          )

          SELECT 
              (SELECT venue_id FROM venue_info) AS venue_id,
              (SELECT venue_name FROM venue_info) AS venue_name,

              COUNT(*) AS total_matches, -- ✅ Count of all matches where toss happened

              -- Count toss decisions, making sure NULL values don't get ignored
              SUM(CASE WHEN toss_decision = '1' THEN 1 ELSE 0 END) AS choose_to_bat,
              SUM(CASE WHEN toss_decision = '2' THEN 1 ELSE 0 END) AS choose_to_chase,

              -- Correctly calculate percentages to avoid divide by zero errors
              IFNULL(ROUND((SUM(CASE WHEN toss_decision = '1' THEN 1 ELSE 0 END) * 100.0) / COUNT(*)), 0) AS bat_first_percentage,
              IFNULL(ROUND((SUM(CASE WHEN toss_decision = '2' THEN 1 ELSE 0 END) * 100.0) / COUNT(*)), 0) AS chase_percentage,

              -- ✅ Corrected Win Calculation
              SUM(CASE 
                  WHEN toss_decision = '1' AND (winning_team_id = team_1 OR winning_team_id = team_2) THEN 1 
                  ELSE 0
              END) AS wins_batting_first,

              SUM(CASE 
                  WHEN toss_decision = '2' AND (winning_team_id = team_1 OR winning_team_id = team_2) THEN 1 
                  ELSE 0
              END) AS wins_chasing

          FROM toss_decisions;
      `;

    const [results] = await db.execute(query, [match_id]);

    if (results.length === 0) {
      return res
        .status(404)
        .json({ message: "No toss data found for this match_id" });
    }

    res.json(results[0]);
  } catch (error) {
    console.error("❌ Error fetching toss trends:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/toss-win-trends", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    const query = `
      WITH venue_matches AS (
          SELECT 
              m.api_id AS match_id, 
              m.venue_id, 
              m.team_1, 
              m.team_2, 
              JSON_UNQUOTE(JSON_EXTRACT(m.toss, '$.winner')) AS extracted_toss_api_id,

              -- Convert API ID to actual team_id using the teams table
              CASE 
                  WHEN t.id = m.team_1 THEN m.team_1
                  WHEN t.id = m.team_2 THEN m.team_2
                  ELSE NULL
              END AS toss_winner_team_id,

              m.winning_team_id
          FROM matches m
          LEFT JOIN teams t ON CAST(JSON_UNQUOTE(JSON_EXTRACT(m.toss, '$.winner')) AS UNSIGNED) = t.api_id
          WHERE m.venue_id = (SELECT venue_id FROM matches WHERE api_id = ?)
          AND m.toss IS NOT NULL
          AND m.winning_team_id IS NOT NULL
          AND m.match_status_id IN (2, 3, 4) 
          ORDER BY m.date_start DESC
          LIMIT 5
      )

      SELECT 
          COUNT(*) AS total_matches,
          SUM(CASE WHEN toss_winner_team_id = winning_team_id THEN 1 ELSE 0 END) AS wins_after_toss,
          SUM(CASE WHEN toss_winner_team_id IS NOT NULL AND toss_winner_team_id != winning_team_id THEN 1 ELSE 0 END) AS losses_after_toss,

          -- Calculate win & loss percentages safely (avoid division by zero)
          ROUND(
              (SUM(CASE WHEN toss_winner_team_id = winning_team_id THEN 1 ELSE 0 END) * 100.0) / 
              NULLIF(SUM(CASE WHEN toss_winner_team_id IS NOT NULL THEN 1 ELSE 0 END), 0), 0
          ) AS win_percentage_after_toss,

          ROUND(
              (SUM(CASE WHEN toss_winner_team_id != winning_team_id THEN 1 ELSE 0 END) * 100.0) / 
              NULLIF(SUM(CASE WHEN toss_winner_team_id IS NOT NULL THEN 1 ELSE 0 END), 0), 0
          ) AS loss_percentage_after_toss

      FROM venue_matches
      WHERE toss_winner_team_id IS NOT NULL;
    `;

    const [results] = await db.execute(query, [match_id]);

    if (results.length === 0) {
      return res
        .status(404)
        .json({ message: "No toss win data found for this match_id" });
    }

    const result = results[0];

    res.json({
      match_id: match_id,
      total_matches: result.total_matches,
      toss_win_summary: {
        win_percentage: `${result.win_percentage_after_toss}%`,
        loss_percentage: `${result.loss_percentage_after_toss}%`,
        win: `${result.wins_after_toss} Matches`,
        loss: `${result.losses_after_toss} Matches`,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching toss win trends:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});


app.get("/suggested-players", async (req, res) => {
  try {
    let { match_id } = req.query; // ✅ Keep match_id in the request

    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    // ✅ Step 1: Check if match_id is actually an api_id and needs conversion
    const matchQuery = `SELECT id FROM matches WHERE api_id = ? LIMIT 1`;
    const [matchResult] = await db.execute(matchQuery, [match_id]); // Using match_id as api_id

    if (matchResult.length > 0) {
      match_id = matchResult[0].id; // ✅ Convert api_id to actual match_id
    }

    // ✅ Step 2: Fetch suggested players using the actual match_id
    const query = `
      WITH player_squads AS (
          -- ✅ Get all players in the squad for the given match_id
          SELECT player_id, team_id FROM match_squads WHERE match_id = ?
      ),

      player_last_matches AS (
          -- ✅ Get last 5 matches per player using ROW_NUMBER()
          SELECT player_id, match_id
          FROM (
              SELECT 
                  pfp.player_id, 
                  pfp.match_id,
                  ROW_NUMBER() OVER (PARTITION BY pfp.player_id ORDER BY pfp.match_id DESC) AS row_num
              FROM match_fantasy_points pfp
              WHERE pfp.player_id IN (SELECT player_id FROM player_squads)
          ) ranked_matches
          WHERE row_num <= 5  -- ✅ Ensures only last 5 matches per player
      )

      SELECT 
          pfp.player_id,
          pfp.player_name,
          pfp.role,
          ps.team_id,  -- ✅ Fetch Team ID from match_squads
          t.name AS team_name,  -- ✅ Fetch Team Name from teams table
          SUM(pfp.point) AS total_points,  -- ✅ Total fantasy points in last 5 matches
          AVG(pfp.point) AS avg_points,    -- ✅ Average fantasy points per match
          COUNT(pfp.match_id) AS matches_played  -- ✅ Matches counted (max 5)
      FROM match_fantasy_points pfp
      JOIN player_last_matches plm 
          ON pfp.player_id = plm.player_id 
          AND pfp.match_id = plm.match_id
      JOIN player_squads ps ON pfp.player_id = ps.player_id  -- ✅ Join to get team_id
      JOIN teams t ON ps.team_id = t.id  -- ✅ Fetch Team Name from teams table
      GROUP BY pfp.player_id, pfp.player_name, pfp.role, ps.team_id, t.name
      ORDER BY total_points DESC;
    `;

    const [results] = await db.execute(query, [match_id]);

    if (results.length === 0) {
      return res
        .status(404)
        .json({ message: "No player data found for this match_id" });
    }

    res.json({
      match_id: match_id, // ✅ Keeping match_id in response
      players: results.map((player) => ({
        player_id: player.player_id,
        player_name: player.player_name,
        role: player.role,
        team_id: player.team_id,
        team_name: player.team_name,
        total_points: player.total_points,
        avg_points: player.avg_points,
        matches_played: player.matches_played,
      })),
    });
  } catch (error) {
    console.error("❌ Error fetching suggested players:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});



app.get("/top-players-venue", async (req, res) => {
  try {
    let { match_id } = req.query; // ✅ Keep match_id in the request

    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    // ✅ Step 1: Convert api_id to match_id if needed
    const matchQuery = `SELECT id FROM matches WHERE api_id = ? LIMIT 1`;
    const [matchResult] = await db.execute(matchQuery, [match_id]); // Using match_id as api_id

    if (matchResult.length > 0) {
      match_id = matchResult[0].id; // ✅ Convert api_id to actual match_id
    }

    // ✅ Step 2: Fetch top players at the venue using match_id
    const query = `
      WITH venue_info AS (
          -- ✅ Get venue_id for the given match_id
          SELECT venue_id FROM matches WHERE id = ?
      ),

      player_squads AS (
          -- ✅ Get all players in the squad for the given match_id
          SELECT player_id, team_id FROM match_squads WHERE match_id = ?
      ),

      player_venue_matches AS (
          -- ✅ Fetch last matches played at this venue
          SELECT 
              pfp.player_id,
              pfp.player_name,
              pfp.match_id,
              ps.team_id,  -- ✅ Fetch team_id from match_squads
              pfp.point AS fantasy_points
          FROM match_fantasy_points pfp
          JOIN matches m ON pfp.match_id = m.id
          JOIN player_squads ps ON pfp.player_id = ps.player_id  -- ✅ Ensure correct player-team mapping
          WHERE m.venue_id = (SELECT venue_id FROM venue_info)
          ORDER BY m.date_start DESC
      ),

      player_total_points AS (
          -- ✅ Aggregate total points per player at this venue
          SELECT 
              pfp.player_id,
              pfp.player_name,
              pfp.team_id,
              t.name AS team_name,  -- ✅ Fetch correct team name
              SUM(pfp.fantasy_points) AS total_points,
              COUNT(pfp.match_id) AS matches_played
          FROM player_venue_matches pfp
          JOIN teams t ON pfp.team_id = t.id  -- ✅ Fetch team name
          GROUP BY pfp.player_id, pfp.player_name, pfp.team_id, t.name
      )

      -- ✅ Fetch top 5 players with highest fantasy points at this venue
      SELECT 
          ptp.player_id,
          ptp.player_name,
          ptp.team_id,
          ptp.team_name,
          ptp.total_points,
          ptp.matches_played
      FROM player_total_points ptp
      ORDER BY total_points DESC
      LIMIT 5;
    `;

    const [results] = await db.execute(query, [match_id, match_id]); // ✅ Pass match_id twice for venue and squads

    if (results.length === 0) {
      return res
        .status(404)
        .json({ message: "No top player data found for this venue" });
    }

    res.json({
      match_id: match_id,  // ✅ Keeping match_id in response
      top_players: results.map((player) => ({
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        total_points: player.total_points,
        matches_played: player.matches_played,
      })),
    });
  } catch (error) {
    console.error(
      "❌ Error fetching top players at this venue:",
      error.message
    );
    res.status(500).json({ message: "Server error" });
  }
});



// ---------------------------------------------------stats payground------------------------------------------------



const getStatField = (statType) => {
  switch (statType) {
    case "TotalFantasyPoints":
      return "SUM(pfp.point) AS total_points";
    case "WicketsTaken":
      return "SUM(bowl.wickets) AS wickettaken";
    case "RunsScored":
      return "SUM(bat.runs) AS total_runs";
    case "StrikeRate":
      return `CASE 
                WHEN SUM(bat.balls_faced) > 0 
                THEN ROUND((SUM(bat.runs) / SUM(bat.balls_faced)) * 100, 2) 
                ELSE NULL 
              END AS strike_rate`;
    case "EconomyRate":
      return `CASE 
                WHEN SUM(bowl.overs) > 0 
                THEN ROUND(SUM(bowl.runs_conceded) / SUM(bowl.overs), 2) 
                ELSE NULL 
              END AS economy_rate`;
    case "AverageFantasyPoints":
      return "ROUND(AVG(pfp.point), 2) AS avg_fantasy_points";
    case "DreamTeamAppearances":
      return "COUNT(DISTINCT CASE WHEN mdt.player_id IS NOT NULL THEN mdt.match_id END) AS dream_team_appearances";
    case "CaptainCount":
      return "SUM(CASE WHEN mdt.is_captain = 1 THEN 1 ELSE 0 END) AS captain_count";
    case "ViceCaptainCount":
      return "SUM(CASE WHEN mdt.is_vice_captain = 1 THEN 1 ELSE 0 END) AS vice_captain_count";
    default:
      return null;
  }
};

app.get("/stats", async (req, res) => {
  try {
    const { match_id, statType } = req.query;

    if (!match_id || !statType) {
      return res.status(400).json({ error: "match_id and statType are required." });
    }

    const statField = getStatField(statType);
    if (!statField) {
      return res.status(400).json({ error: "Invalid statType provided." });
    }

    const query = `
      WITH player_squads AS (
          SELECT player_id, team_id
          FROM match_squads
          WHERE match_id = ?
      ),
      player_last_matches AS (
          SELECT player_id, match_id
          FROM (
              SELECT 
                  pfp.player_id, 
                  pfp.match_id,
                  ROW_NUMBER() OVER (PARTITION BY pfp.player_id ORDER BY pfp.match_id DESC) AS row_num
              FROM match_fantasy_points pfp
              WHERE pfp.player_id IN (SELECT player_id FROM player_squads)
          ) ranked_matches
          WHERE row_num <= 5
      )
      SELECT 
          ps.player_id,
          COALESCE(pfp.player_name, 'Unknown') AS player_name,
          COALESCE(pfp.role, 'Unknown') AS role,
          ps.team_id,
          COALESCE(t.name, 'Unknown') AS team_name,
          COALESCE(COUNT(DISTINCT plm.match_id), 0) AS matches_played,
          ${statField}
      FROM player_squads ps
      LEFT JOIN player_last_matches plm 
          ON ps.player_id = plm.player_id 
      LEFT JOIN match_fantasy_points pfp 
          ON plm.player_id = pfp.player_id 
          AND plm.match_id = pfp.match_id
      LEFT JOIN teams t 
          ON ps.team_id = t.id
      LEFT JOIN match_inning_batters bat  
          ON ps.player_id = bat.batsman_id 
          AND bat.match_inning_id IN (SELECT id FROM match_innings WHERE match_id = plm.match_id)
      LEFT JOIN match_inning_bowlers bowl  
          ON ps.player_id = bowl.bowler_id 
          AND bowl.match_inning_id IN (SELECT id FROM match_innings WHERE match_id = plm.match_id)
      LEFT JOIN match_dream_teams mdt  
          ON ps.player_id = mdt.player_id 
          AND plm.match_id = mdt.match_id
      GROUP BY ps.player_id, pfp.player_name, pfp.role, ps.team_id, t.name
      ORDER BY matches_played DESC;
    `;

    const [rows] = await db.execute(query, [match_id]);
    res.json(rows);
  } catch (error) {
    console.error("❌ Error fetching data:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});


// --------------------------------cheat sheet ----------------------------------------------

// API Route
app.get("/player-fantasy-stats", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ error: "match_id is required." });
    }

    const query = `
      WITH player_squads AS (
          -- ✅ Get all players in the squad for the given match_id
          SELECT player_id, team_id, playing11
          FROM match_squads
          WHERE match_id = ?
      ),

      last_match AS (
          -- ✅ Get last match per player
          SELECT 
              pfp.player_id, 
              pfp.match_id,
              pfp.point AS last_match_points,
              ROW_NUMBER() OVER (PARTITION BY pfp.player_id ORDER BY pfp.match_id DESC) AS row_num
          FROM match_fantasy_points pfp
          WHERE pfp.player_id IN (SELECT player_id FROM player_squads)
      ),

      filtered_last_match AS (
          -- ✅ Only the last match for each player
          SELECT player_id, match_id, last_match_points
          FROM last_match
          WHERE row_num = 1  -- Only keep the most recent match
      ),

      last_5_matches AS (
          -- ✅ Get last 5 matches per player
          SELECT player_id, match_id, SUM(point) AS total_points, 
                 ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY match_id DESC) AS row_num
          FROM match_fantasy_points
          WHERE player_id IN (SELECT player_id FROM player_squads)
          GROUP BY player_id, match_id
      ),

      last_5_summary AS (
          -- ✅ Aggregate last 5 matches
          SELECT player_id,
                 COUNT(match_id) AS matches_played_last_5,
                 SUM(total_points) AS total_points_last_5,
                 ROUND(AVG(total_points), 2) AS avg_fantasy_points_last_5
          FROM last_5_matches
          WHERE row_num <= 5
          GROUP BY player_id
      ),

      overall_summary AS (
          -- ✅ Aggregate overall matches
          SELECT player_id,
                 COUNT(match_id) AS matches_played_overall,
                 SUM(point) AS total_points_overall,
                 ROUND(AVG(point), 2) AS avg_fantasy_points_overall
          FROM match_fantasy_points
          WHERE player_id IN (SELECT player_id FROM player_squads)
          GROUP BY player_id
      )

      -- ✅ Final Data Selection
      SELECT 
          ps.player_id,
          COALESCE(pfp.player_name, 'Unknown') AS player_name,
          ps.team_id,
          COALESCE(t.name, 'Unknown') AS team_name,
          ps.playing11,  -- ✅ Now including the playing 11 status
          
          -- ✅ Last Match Points
          COALESCE(flm.last_match_points, 0) AS last_match_points,

          -- ✅ Last 5 Matches Summary
          COALESCE(l5s.matches_played_last_5, 0) AS matches_played_last_5,
          COALESCE(l5s.total_points_last_5, 0) AS total_points_last_5,
          COALESCE(l5s.avg_fantasy_points_last_5, 0) AS avg_fantasy_points_last_5,

          -- ✅ Overall Stats
          COALESCE(os.matches_played_overall, 0) AS matches_played_overall,
          COALESCE(os.total_points_overall, 0) AS total_points_overall,
          COALESCE(os.avg_fantasy_points_overall, 0) AS avg_fantasy_points_overall

      FROM player_squads ps
      LEFT JOIN match_fantasy_points pfp 
          ON ps.player_id = pfp.player_id
      LEFT JOIN teams t 
          ON ps.team_id = t.id
      LEFT JOIN filtered_last_match flm 
          ON ps.player_id = flm.player_id
      LEFT JOIN last_5_summary l5s 
          ON ps.player_id = l5s.player_id
      LEFT JOIN overall_summary os 
          ON ps.player_id = os.player_id
      GROUP BY ps.player_id, pfp.player_name, ps.team_id, t.name, ps.playing11, flm.last_match_points, 
               l5s.matches_played_last_5, l5s.total_points_last_5, l5s.avg_fantasy_points_last_5,
               os.matches_played_overall, os.total_points_overall, os.avg_fantasy_points_overall
      ORDER BY total_points_last_5 DESC;  -- ✅ Sort by top players in last 5 matches
    `;

    const [rows] = await db.execute(query, [match_id]);
    res.json(rows);
  } catch (error) {
    console.error("❌ Error fetching data:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// --------------------------------------VENUE AND PITCH REPORT ------------------------------

app.get("/venue-pitch-report", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ error: "match_id is required." });
    }

    // ✅ Step 1: Fetch Venue ID from match_id
    const venueQuery = `SELECT venue_id FROM matches WHERE id = ? LIMIT 1;`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);

    if (!venueResult.length || !venueResult[0].venue_id) {
      return res
        .status(404)
        .json({ error: "Match not found or Venue ID is missing." });
    }

    const venue_id = venueResult[0].venue_id;

    // ✅ Step 2: Fetch last 5 matches at this venue
    const lastMatchesQuery = `
        SELECT id FROM matches 
        WHERE venue_id = ? 
        ORDER BY date_start DESC 
        LIMIT 5;
    `;
    const [lastMatches] = await db.execute(lastMatchesQuery, [venue_id]);

    if (!lastMatches.length) {
      return res
        .status(404)
        .json({ error: "No recent matches found at this venue." });
    }

    const matchIds = lastMatches.map((m) => m.id);

    // ✅ Step 3: Fetch venue stats for last 5 matches
    const query = `
      WITH first_innings_scores AS (
          SELECT match_id, AVG(score_runs) AS avg_first_inning_score
          FROM match_innings
          WHERE match_id IN (${matchIds.map(() => "?").join(",")}) 
          AND number = 1
          GROUP BY match_id
      ),

      wickets_per_inning AS (
          SELECT mi.match_id, COUNT(f.batsman_id) AS avg_wickets_lost
          FROM match_innings mi
          LEFT JOIN match_inning_fows f ON mi.id = f.match_inning_id
          WHERE mi.match_id IN (${matchIds.map(() => "?").join(",")})
          GROUP BY mi.match_id
      ),

      player_roles AS (
          SELECT ms.match_id,
                 SUM(CASE WHEN p.playing_role = 'batsman' THEN 1 ELSE 0 END) AS batsmen_count,
                 SUM(CASE WHEN p.playing_role = 'bowler' THEN 1 ELSE 0 END) AS bowlers_count
          FROM match_squads ms
          JOIN players p ON ms.player_id = p.id
          WHERE ms.match_id IN (${matchIds.map(() => "?").join(",")})
          AND ms.playing11 = 'true'
          GROUP BY ms.match_id
      )

      SELECT 
          v.id AS venue_id,
          v.name AS venue_name,
          COALESCE(AVG(fis.avg_first_inning_score), 0) AS avg_first_inning_score,
          COALESCE(AVG(wpi.avg_wickets_lost), 0) AS avg_wickets_lost,

          CASE 
              WHEN AVG(pr.batsmen_count) > AVG(pr.bowlers_count) THEN 'Better for Batsmen'
              WHEN AVG(pr.batsmen_count) < AVG(pr.bowlers_count) THEN 'Better for Bowlers'
              ELSE 'Balanced for Both'
          END AS pitch_report

      FROM venues v
      LEFT JOIN first_innings_scores fis ON 1=1
      LEFT JOIN wickets_per_inning wpi ON 1=1
      LEFT JOIN player_roles pr ON 1=1
      WHERE v.id = ?
      GROUP BY v.id, v.name;
    `;

    // ✅ Pass matchIds + venue_id as parameters
    const params = [...matchIds, ...matchIds, ...matchIds, venue_id];
    const [rows] = await db.execute(query, params);

    if (!rows.length) {
      return res
        .status(404)
        .json({ error: "No data available for this venue." });
    }

    res.json(rows[0]); // ✅ Return venue pitch report
  } catch (error) {
    console.error("❌ Error fetching venue pitch report:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/venue-pitch-report-last-match", async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id)
      return res.status(400).json({ error: "match_id is required." });

    // Step 1: Fetch Venue ID
    const venueQuery = `SELECT venue_id FROM matches WHERE id = ? LIMIT 1;`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    if (!venueResult.length)
      return res.status(404).json({ error: "Match not found." });

    const venue_id = venueResult[0].venue_id;

    // Step 2: Fetch the last completed match at this venue
    const lastMatchQuery = `
      SELECT id FROM matches 
      WHERE venue_id = ? 
      AND match_status_id = 2  -- ✅ Only select completed matches
      ORDER BY date_start DESC 
      LIMIT 1;  -- ✅ Only fetch the last match
    `;
    const [lastMatchResult] = await db.execute(lastMatchQuery, [venue_id]);
    if (!lastMatchResult.length)
      return res
        .status(404)
        .json({ error: "No completed match found at this venue." });

    const lastMatchId = lastMatchResult[0].id;

    // Step 3: Fetch venue stats for the last match
    const query = `
      SELECT 
          v.id AS venue_id,
          v.name AS venue_name,
          mi.score_runs AS first_inning_score,
          COUNT(f.batsman_id) AS wickets_lost
      FROM venues v
      JOIN match_innings mi ON mi.match_id = ?
      LEFT JOIN match_inning_fows f ON mi.id = f.match_inning_id
      WHERE v.id = ?
      GROUP BY v.id, v.name, mi.score_runs;
    `;

    const [rows] = await db.execute(query, [lastMatchId, venue_id]);

    if (!rows.length)
      return res
        .status(404)
        .json({ error: "No data available for this venue." });

    res.json(rows[0]);
  } catch (error) {
    console.error("❌ Error fetching venue pitch report:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/venue-toss-trends", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ error: "match_id is required." });
    }

    // ✅ Step 1: Fetch Venue ID & Venue Name from match_id
    const venueQuery = `SELECT v.id AS venue_id, v.name AS venue_name 
                        FROM matches m 
                        JOIN venues v ON m.venue_id = v.id 
                        WHERE m.id = ? LIMIT 1;`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);

    if (!venueResult.length || !venueResult[0].venue_id) {
      return res
        .status(404)
        .json({ error: "Match not found or Venue ID is missing." });
    }

    const venue_id = venueResult[0].venue_id;
    const venue_name = venueResult[0].venue_name;

    // ✅ Step 2: Fetch last 10 matches at this venue
    const lastMatchesQuery = `
        SELECT id, toss, winning_team_id, team_1, team_2
        FROM matches 
        WHERE venue_id = ? 
        ORDER BY date_start DESC 
        LIMIT 10;
    `;
    const [lastMatches] = await db.execute(lastMatchesQuery, [venue_id]);

    if (!lastMatches.length) {
      return res
        .status(404)
        .json({ error: "No recent matches found at this venue." });
    }

    let totalMatches = lastMatches.length;
    let batFirst = 0,
      chase = 0;
    let winBattingFirst = 0,
      winChasing = 0;
    let tossWins = 0,
      tossLosses = 0;

    lastMatches.forEach((match) => {
      let tossWinnerTeam = match.toss.includes("bat") ? "Bat First" : "Chase";
      let didTeamWin = match.winning_team_id ? 1 : 0;

      if (tossWinnerTeam === "Bat First") {
        batFirst++;
        if (didTeamWin) winBattingFirst++;
      } else if (tossWinnerTeam === "Chase") {
        chase++;
        if (didTeamWin) winChasing++;
      }

      if (didTeamWin) tossWins++;
      else tossLosses++;
    });

    // ✅ Step 3: Handle Edge Cases (Avoid Division by Zero)
    let choose_to_bat_first = batFirst
      ? ((batFirst / totalMatches) * 100).toFixed(2) + "%"
      : "0.00%";
    let choose_to_chase = chase
      ? ((chase / totalMatches) * 100).toFixed(2) + "%"
      : "0.00%";

    let win_batting_first = batFirst
      ? ((winBattingFirst / batFirst) * 100).toFixed(2) + "%"
      : "0.00%";
    let win_chasing = chase
      ? ((winChasing / chase) * 100).toFixed(2) + "%"
      : "0.00%";

    let win_percentage = ((tossWins / totalMatches) * 100).toFixed(2) + "%";
    let loss_percentage = ((tossLosses / totalMatches) * 100).toFixed(2) + "%";

    let tossTrends = {
      venue_id,
      venue_name, // ✅ Added venue name
      matches_analyzed: totalMatches,
      toss_decision: {
        choose_to_bat_first,
        choose_to_chase,
      },
      win_percentages: {
        win_batting_first,
        win_chasing,
      },
      toss_win_record: {
        wins_after_winning_toss: `${tossWins}/${totalMatches} matches`,
        win_percentage,
        loss_percentage,
      },
    };

    res.json(tossTrends);
  } catch (error) {
    console.error("❌ Error fetching venue toss trends:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/venue-toss-trends-last-match", async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id)
      return res.status(400).json({ error: "match_id is required." });

    // Step 1: Fetch Venue ID
    const venueQuery = `SELECT venue_id FROM matches WHERE id = ? LIMIT 1;`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    if (!venueResult.length)
      return res.status(404).json({ error: "Match not found." });

    const venue_id = venueResult[0].venue_id;

    // Step 2: Fetch the last completed match at this venue
    const lastMatchQuery = `
      SELECT id, toss, winning_team_id 
      FROM matches 
      WHERE venue_id = ? 
      AND match_status_id = 2  
      ORDER BY date_start DESC 
      LIMIT 1;
    `;
    const [lastMatchResult] = await db.execute(lastMatchQuery, [venue_id]);
    if (!lastMatchResult.length)
      return res
        .status(404)
        .json({ error: "No completed match found at this venue." });

    const lastMatch = lastMatchResult[0];

    // Step 3: Analyze Toss Trends for Last Match
    const tossWinner = lastMatch.toss.includes("bat") ? "Bat First" : "Chase";
    const tossWin = lastMatch.winning_team_id ? "Won" : "Lost";

    res.json({
      venue_id,
      last_match_id: lastMatch.id,
      toss_decision: tossWinner,
      toss_win_result: tossWin,
    });
  } catch (error) {
    console.error("❌ Error fetching venue toss trends:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/top-players-at-venue", async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    // Step 1: Fetch Venue ID
    const venueQuery = `SELECT venue_id FROM matches WHERE id = ? LIMIT 1;`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    if (!venueResult.length) {
      return res.status(404).json({ message: "Match not found" });
    }
    const venue_id = venueResult[0].venue_id;

    // Step 2: Get Player Squads
    const squadQuery = `SELECT player_id FROM match_squads WHERE match_id = ?;`;
    const [squadPlayers] = await db.execute(squadQuery, [match_id]);
    if (!squadPlayers.length) {
      return res
        .status(404)
        .json({ message: "No squad data found for this match" });
    }

    let playerData = [];

    for (const player of squadPlayers) {
      const playerId = player.player_id;

      // Step 3: Find Player's Last Matches at This Venue
      const lastMatchesQuery = `
        SELECT id AS match_id FROM matches 
        WHERE venue_id = ? 
        AND match_status_id = 2 
        AND id IN (SELECT match_id FROM match_squads WHERE player_id = ?) 
        ORDER BY date_start DESC 
        LIMIT 5;
      `;
      const [lastMatches] = await db.execute(lastMatchesQuery, [
        venue_id,
        playerId,
      ]);

      if (!lastMatches.length) {
        playerData.push({
          player_id: playerId,
          status: "no previous match played",
        });
        continue;
      }

      let lastMatchWithPoints = null;
      for (const match of lastMatches) {
        const checkPointsQuery = `SELECT COUNT(*) AS count FROM match_fantasy_points WHERE match_id = ? AND player_id = ?;`;
        const [pointsCheck] = await db.execute(checkPointsQuery, [
          match.match_id,
          playerId,
        ]);
        if (pointsCheck[0].count > 0) {
          lastMatchWithPoints = match.match_id;
          break;
        }
      }

      if (!lastMatchWithPoints) {
        playerData.push({
          player_id: playerId,
          status: "no previous match with fantasy points",
        });
        continue;
      }

      // Step 4: Fetch Fantasy Points
      const fantasyPointsQuery = `
        SELECT player_id, player_name, point AS fantasy_points 
        FROM match_fantasy_points 
        WHERE match_id = ? AND player_id = ? 
        ORDER BY point DESC;
      `;
      const [pointsData] = await db.execute(fantasyPointsQuery, [
        lastMatchWithPoints,
        playerId,
      ]);

      if (pointsData.length > 0) {
        playerData.push({
          player_id: pointsData[0].player_id,
          player_name: pointsData[0].player_name,
          fantasy_points: pointsData[0].fantasy_points,
        });
      }
    }

    // Sort Players by Fantasy Points in Descending Order
    playerData = playerData.sort(
      (a, b) => (b.fantasy_points || 0) - (a.fantasy_points || 0)
    );

    res.json({
      venue_id,
      players: playerData,
    });
  } catch (error) {
    console.error("❌ Error fetching top players at venue:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/top-players-at-venue-last-match", async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id)
      return res.status(400).json({ message: "match_id is required" });

    // Step 1: Fetch Venue ID
    const venueQuery = `SELECT venue_id FROM matches WHERE id = ? LIMIT 1;`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    if (!venueResult.length)
      return res.status(404).json({ message: "Match not found" });

    const venue_id = venueResult[0].venue_id;

    // Step 2: Get Player Squads
    const squadQuery = `SELECT player_id FROM match_squads WHERE match_id = ?;`;
    const [squadPlayers] = await db.execute(squadQuery, [match_id]);
    if (!squadPlayers.length)
      return res
        .status(404)
        .json({ message: "No squad data found for this match" });

    // Step 3: Fetch the last match at this venue
    const lastMatchQuery = `
      SELECT id FROM matches 
      WHERE venue_id = ? 
      AND match_status_id = 2  
      ORDER BY date_start DESC 
      LIMIT 1;
    `;
    const [lastMatchResult] = await db.execute(lastMatchQuery, [venue_id]);
    if (!lastMatchResult.length)
      return res
        .status(404)
        .json({ message: "No completed match found at this venue." });

    const lastMatchId = lastMatchResult[0].id;

    let playerData = [];

    for (const player of squadPlayers) {
      const playerId = player.player_id;

      // Step 4: Fetch Fantasy Points for Last Match
      const fantasyPointsQuery = `
        SELECT player_id, player_name, point AS fantasy_points 
        FROM match_fantasy_points 
        WHERE match_id = ? AND player_id = ? 
        ORDER BY point DESC;
      `;
      const [pointsData] = await db.execute(fantasyPointsQuery, [
        lastMatchId,
        playerId,
      ]);

      if (pointsData.length > 0) {
        playerData.push({
          player_id: pointsData[0].player_id,
          player_name: pointsData[0].player_name,
          fantasy_points: pointsData[0].fantasy_points,
        });
      } else {
        playerData.push({
          player_id: playerId,
          status: "No fantasy points recorded for last match",
        });
      }
    }

    // Sort Players by Fantasy Points in Descending Order
    playerData = playerData.sort(
      (a, b) => (b.fantasy_points || 0) - (a.fantasy_points || 0)
    );

    res.json({
      venue_id,
      last_match_id: lastMatchId,
      players: playerData,
    });
  } catch (error) {
    console.error("❌ Error fetching top players at venue:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/venue-pitch-report-overall", async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id) {
      return res.status(400).json({ error: "match_id is required." });
    }

    // Fetch Venue ID
    const venueQuery = `SELECT venue_id FROM matches WHERE id = ? LIMIT 1;`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    if (!venueResult.length) {
      return res.status(404).json({ error: "Match not found" });
    }
    const venue_id = venueResult[0].venue_id;

    // Fetch all matches played at this venue
    const allMatchesQuery = `SELECT id FROM matches WHERE venue_id = ? AND match_status_id = 2 ORDER BY date_start DESC;`;
    const [allMatches] = await db.execute(allMatchesQuery, [venue_id]);
    if (!allMatches.length) {
      return res
        .status(404)
        .json({ error: "No completed matches at this venue." });
    }

    const matchIds = allMatches.map((m) => m.id);

    // Compute pitch report from all matches
    const query = `
      SELECT 
        v.id AS venue_id,
        v.name AS venue_name,
        COALESCE(AVG(mi.score_runs), 0) AS avg_first_inning_score,
        COALESCE(AVG(fow.runs), 0) AS avg_wickets_lost
      FROM venues v
      JOIN matches m ON v.id = m.venue_id
      JOIN match_innings mi ON mi.match_id = m.id AND mi.number = 1
      LEFT JOIN match_inning_fows fow ON mi.id = fow.match_inning_id
      WHERE v.id = ?
      GROUP BY v.id, v.name;
    `;

    const [rows] = await db.execute(query, [venue_id]);

    if (!rows.length) {
      return res
        .status(404)
        .json({ error: "No overall venue data available." });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(
      "❌ Error fetching overall venue pitch report:",
      error.message
    );
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/venue-toss-trends-overall", async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id) {
      return res.status(400).json({ error: "match_id is required." });
    }

    // Fetch Venue ID
    const venueQuery = `SELECT venue_id FROM matches WHERE id = ? LIMIT 1;`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    if (!venueResult.length) {
      return res.status(404).json({ error: "Match not found" });
    }
    const venue_id = venueResult[0].venue_id;

    // Fetch all completed matches at this venue
    const allMatchesQuery = `
      SELECT id, toss, winning_team_id, team_1, team_2
      FROM matches
      WHERE venue_id = ? AND match_status_id = 2
      ORDER BY date_start DESC;
    `;
    const [allMatches] = await db.execute(allMatchesQuery, [venue_id]);

    if (!allMatches.length) {
      return res
        .status(404)
        .json({ error: "No completed matches found at this venue." });
    }

    let totalMatches = allMatches.length;
    let batFirst = 0,
      chase = 0;
    let winBattingFirst = 0,
      winChasing = 0;
    let tossWins = 0,
      tossLosses = 0;

    allMatches.forEach((match) => {
      let tossWinnerTeam = match.toss.includes("bat") ? "Bat First" : "Chase";
      let didTeamWin = match.winning_team_id ? 1 : 0;

      if (tossWinnerTeam === "Bat First") {
        batFirst++;
        if (didTeamWin) winBattingFirst++;
      } else if (tossWinnerTeam === "Chase") {
        chase++;
        if (didTeamWin) winChasing++;
      }

      if (didTeamWin) tossWins++;
      else tossLosses++;
    });

    // Handle percentages
    let choose_to_bat_first = batFirst
      ? ((batFirst / totalMatches) * 100).toFixed(2) + "%"
      : "0.00%";
    let choose_to_chase = chase
      ? ((chase / totalMatches) * 100).toFixed(2) + "%"
      : "0.00%";
    let win_batting_first = batFirst
      ? ((winBattingFirst / batFirst) * 100).toFixed(2) + "%"
      : "0.00%";
    let win_chasing = chase
      ? ((winChasing / chase) * 100).toFixed(2) + "%"
      : "0.00%";

    res.json({
      venue_id,
      matches_analyzed: totalMatches,
      toss_decision: { choose_to_bat_first, choose_to_chase },
      win_percentages: { win_batting_first, win_chasing },
    });
  } catch (error) {
    console.error(
      "❌ Error fetching overall venue toss trends:",
      error.message
    );
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/top-players-at-venue-overall", async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    // Fetch Venue ID
    const venueQuery = `SELECT venue_id FROM matches WHERE id = ? LIMIT 1;`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    if (!venueResult.length) {
      return res.status(404).json({ message: "Match not found" });
    }
    const venue_id = venueResult[0].venue_id;

    // Fetch all matches at the venue
    const allMatchesQuery = `
      SELECT id FROM matches
      WHERE venue_id = ? AND match_status_id = 2
      ORDER BY date_start DESC;
    `;
    const [allMatches] = await db.execute(allMatchesQuery, [venue_id]);
    if (!allMatches.length) {
      return res
        .status(404)
        .json({ message: "No completed matches at this venue." });
    }

    const matchIds = allMatches.map((m) => m.id);

    // Fetch top players based on fantasy points
    const topPlayersQuery = `
      SELECT 
        pfp.player_id,
        pfp.player_name,
        SUM(pfp.point) AS total_fantasy_points
      FROM match_fantasy_points pfp
      WHERE pfp.match_id IN (${matchIds.map(() => "?").join(",")})
      GROUP BY pfp.player_id, pfp.player_name
      ORDER BY total_fantasy_points DESC
      LIMIT 10;
    `;

    const [topPlayers] = await db.execute(topPlayersQuery, matchIds);

    res.json({ venue_id, players: topPlayers });
  } catch (error) {
    console.error(
      "❌ Error fetching overall top players at venue:",
      error.message
    );
    res.status(500).json({ message: "Server error" });
  }
});







app.get('/top-players-venue1', async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id) return res.status(400).json({ error: 'match_id is required' });

    const venueQuery = `SELECT venue_id FROM matches WHERE id = ?`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    const venue_id = venueResult[0]?.venue_id;

    if (!venue_id) return res.status(404).json({ error: 'Venue not found for the given match_id' });

    const queryTemplate = (limitClause = '') => `
      SELECT 
        md.player_id, 
        mpf.player_name, 
        COUNT(md.id) as total_matches,
        SUM(md.is_captain) as captain_count,
        SUM(md.is_vice_captain) as vice_captain_count,
        (SUM(md.is_captain) + SUM(md.is_vice_captain)) as total_appearances
      FROM match_dream_teams md
      JOIN match_fantasy_points mpf ON md.player_id = mpf.player_id AND md.match_id = mpf.match_id
      WHERE md.match_id IN (SELECT id FROM matches WHERE venue_id = ?)
      GROUP BY md.player_id, mpf.player_name
      ORDER BY total_appearances DESC, total_matches DESC
      ${limitClause}
    `;

    const [overallPlayers] = await db.execute(queryTemplate('LIMIT 5'), [venue_id]);
    const [last5Players] = await db.execute(queryTemplate('LIMIT 5 OFFSET 5'), [venue_id]);
    const [lastMatchPlayers] = await db.execute(queryTemplate('LIMIT 1'), [venue_id]);

    res.json({
      last_match: lastMatchPlayers,
      last_5_matches: last5Players,
      overall: overallPlayers
    });

  } catch (error) {
    console.error('Error fetching top players at venue:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});



























// -----------------------------------------------------team stats ----------------------------------------

app.get("/team-vs-team", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    // Step 1: Fetch Team IDs and Names
    const teamQuery = `
      SELECT 
        m.team_1, t1.name AS teamA_name,
        m.team_2, t2.name AS teamB_name
      FROM matches m
      JOIN teams t1 ON m.team_1 = t1.id
      JOIN teams t2 ON m.team_2 = t2.id
      WHERE m.id = ? 
      LIMIT 1;
    `;
    const [teamResult] = await db.execute(teamQuery, [match_id]);

    if (!teamResult.length) {
      return res.status(404).json({ message: "Match not found" });
    }

    const teamA = teamResult[0].team_1;
    const teamB = teamResult[0].team_2;
    const teamA_name = teamResult[0].teamA_name;
    const teamB_name = teamResult[0].teamB_name;

    // Step 2: Fetch Head-to-Head Matches
    const matchesQuery = `
      SELECT id, date_start, team_1, team_2, winning_team_id, win_margin
      FROM matches 
      WHERE ((team_1 = ? AND team_2 = ?) OR (team_1 = ? AND team_2 = ?))
        AND match_status_id = 2  -- Only Completed Matches
      ORDER BY date_start DESC;
    `;
    const [matches] = await db.execute(matchesQuery, [
      teamA,
      teamB,
      teamB,
      teamA,
    ]);

    if (!matches.length) {
      return res
        .status(404)
        .json({ message: "No previous matches found between these teams" });
    }

    // Step 3: Calculate Win Stats
    let teamA_wins = 0;
    let teamB_wins = 0;
    let no_results = 0;

    matches.forEach((match) => {
      if (match.winning_team_id === teamA) {
        teamA_wins++;
      } else if (match.winning_team_id === teamB) {
        teamB_wins++;
      } else {
        no_results++;
      }
    });

    const totalMatches = matches.length;
    const teamA_win_percentage = ((teamA_wins / totalMatches) * 100).toFixed(2);
    const teamB_win_percentage = ((teamB_wins / totalMatches) * 100).toFixed(2);

    // Step 4: Fetch Recent 5 Matches with Scores
    const recentMatchesQuery = `
      SELECT id, date_start, team_1, team_2, winning_team_id, win_margin
      FROM matches 
      WHERE ((team_1 = ? AND team_2 = ?) OR (team_1 = ? AND team_2 = ?))
        AND match_status_id = 2 
      ORDER BY date_start DESC 
      LIMIT 5;
    `;
    const [recentMatches] = await db.execute(recentMatchesQuery, [
      teamA,
      teamB,
      teamB,
      teamA,
    ]);

    const formattedRecentMatches = recentMatches.map((match) => {
      return {
        match_date: match.date_start,
        teamA: {
          id: match.team_1,
          name: match.team_1 === teamA ? teamA_name : teamB_name,
        },
        teamB: {
          id: match.team_2,
          name: match.team_2 === teamA ? teamA_name : teamB_name,
        },
        result:
          match.winning_team_id === teamA
            ? `${teamA_name} won`
            : match.winning_team_id === teamB
            ? `${teamB_name} won`
            : "No Result",
        win_margin: match.win_margin || "N/A",
      };
    });

    res.json({
      teams: {
        teamA: {
          id: teamA,
          name: teamA_name,
          win_percentage: `${teamA_win_percentage}%`,
          total_wins: teamA_wins,
        },
        teamB: {
          id: teamB,
          name: teamB_name,
          win_percentage: `${teamB_win_percentage}%`,
          total_wins: teamB_wins,
        },
      },
      total_matches: totalMatches,
      no_results,
      recent_matches: formattedRecentMatches,
    });
  } catch (error) {
    console.error("❌ Error fetching team vs team data:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/team-vs-team-stats", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    // Step 1: Fetch Team IDs and Names
    const teamQuery = `
      SELECT 
        m.team_1, t1.name AS teamA_name,
        m.team_2, t2.name AS teamB_name
      FROM matches m
      JOIN teams t1 ON m.team_1 = t1.id
      JOIN teams t2 ON m.team_2 = t2.id
      WHERE m.id = ? 
      LIMIT 1;
    `;
    const [teamResult] = await db.execute(teamQuery, [match_id]);

    if (!teamResult.length) {
      return res.status(404).json({ message: "Match not found" });
    }

    const teamA = teamResult[0].team_1;
    const teamB = teamResult[0].team_2;
    const teamA_name = teamResult[0].teamA_name;
    const teamB_name = teamResult[0].teamB_name;

    // Step 2: Fetch Head-to-Head Matches
    const matchesQuery = `
      SELECT id, date_start, team_1, team_2, winning_team_id, toss
      FROM matches 
      WHERE ((team_1 = ? AND team_2 = ?) OR (team_1 = ? AND team_2 = ?))
        AND match_status_id = 2  -- Only Completed Matches
      ORDER BY date_start DESC;
    `;
    const [matches] = await db.execute(matchesQuery, [
      teamA,
      teamB,
      teamB,
      teamA,
    ]);

    if (!matches.length) {
      return res
        .status(404)
        .json({ message: "No previous matches found between these teams" });
    }

    let teamA_batting1st_wins = 0,
      teamA_batting1st_games = 0;
    let teamA_batting2nd_wins = 0,
      teamA_batting2nd_games = 0;
    let teamB_batting1st_wins = 0,
      teamB_batting1st_games = 0;
    let teamB_batting2nd_wins = 0,
      teamB_batting2nd_games = 0;

    matches.forEach((match) => {
      if (!match.toss) return;

      try {
        const tossDetails = JSON.parse(match.toss);
        const tossWinner = parseInt(tossDetails.winner);
        const tossDecision = parseInt(tossDetails.decision); // 1 = Bat first, 2 = Field first

        let battingFirstTeam, battingSecondTeam;

        if (tossDecision === 1) {
          battingFirstTeam = tossWinner;
          battingSecondTeam =
            tossWinner === match.team_1 ? match.team_2 : match.team_1;
        } else {
          battingSecondTeam = tossWinner;
          battingFirstTeam =
            tossWinner === match.team_1 ? match.team_2 : match.team_1;
        }

        // Track games played while batting first or second
        if (battingFirstTeam === teamA) teamA_batting1st_games++;
        if (battingFirstTeam === teamB) teamB_batting1st_games++;
        if (battingSecondTeam === teamA) teamA_batting2nd_games++;
        if (battingSecondTeam === teamB) teamB_batting2nd_games++;

        // Count wins correctly
        if (match.winning_team_id === battingFirstTeam) {
          if (battingFirstTeam === teamA) teamA_batting1st_wins++;
          else if (battingFirstTeam === teamB) teamB_batting1st_wins++;
        } else if (match.winning_team_id === battingSecondTeam) {
          if (battingSecondTeam === teamA) teamA_batting2nd_wins++;
          else if (battingSecondTeam === teamB) teamB_batting2nd_wins++;
        }
      } catch (error) {
        console.warn(
          `⚠️ Error parsing toss data for match ID ${match.id}:`,
          error.message
        );
      }
    });

    // **Fixing Division by Zero issue**
    const teamA_batting1st_win_percentage = teamA_batting1st_games
      ? ((teamA_batting1st_wins / teamA_batting1st_games) * 100).toFixed(2)
      : "0.00";
    const teamA_batting2nd_win_percentage = teamA_batting2nd_games
      ? ((teamA_batting2nd_wins / teamA_batting2nd_games) * 100).toFixed(2)
      : "0.00";
    const teamB_batting1st_win_percentage = teamB_batting1st_games
      ? ((teamB_batting1st_wins / teamB_batting1st_games) * 100).toFixed(2)
      : "0.00";
    const teamB_batting2nd_win_percentage = teamB_batting2nd_games
      ? ((teamB_batting2nd_wins / teamB_batting2nd_games) * 100).toFixed(2)
      : "0.00";

    res.json({
      total_matches: matches.length,
      teams: {
        [teamA_name]: {
          batting_first_win_percentage: `${teamA_batting1st_win_percentage}%`,
          batting_second_win_percentage: `${teamA_batting2nd_win_percentage}%`,
        },
        [teamB_name]: {
          batting_first_win_percentage: `${teamB_batting1st_win_percentage}%`,
          batting_second_win_percentage: `${teamB_batting2nd_win_percentage}%`,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error fetching team vs team data:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------------player overview----------------------------------

app.get("/player-stats", async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id)
      return res.status(400).json({ error: "match_id is required" });

    // Get venue_id for the given match
    const venueQuery = `SELECT venue_id FROM matches WHERE id = ?`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    const venue_id = venueResult[0]?.venue_id;
    const squadQuery = `
    SELECT ms.player_id, ms.team_id, mpf.player_name, t.name as team_name, mpf.role
    FROM match_squads ms
    JOIN match_fantasy_points mpf ON ms.player_id = mpf.player_id AND ms.match_id = mpf.match_id
    JOIN teams t ON ms.team_id = t.id
    WHERE ms.match_id = ?`;
    const [squadPlayers] = await db.execute(squadQuery, [match_id]);

    let playerStats = [];

    for (const player of squadPlayers) {
      const playerId = player.player_id;
      const playerTeamId = player.team_id;

      const overallQuery = `SELECT SUM(point) as total_points, AVG(point) as avg_points, COUNT(DISTINCT match_id) as total_matches FROM match_fantasy_points WHERE player_id = ?`;
      const [overallPoints] = await db.execute(overallQuery, [playerId]);

      const venuePointsQuery = `SELECT AVG(point) as avg_points_venue FROM match_fantasy_points WHERE player_id = ? AND match_id IN (SELECT id FROM matches WHERE venue_id = ?)`;
      const [venuePoints] = await db.execute(venuePointsQuery, [
        playerId,
        venue_id,
      ]);

      const oppositionQuery = `
      SELECT AVG(point) as avg_points_opposition 
      FROM match_fantasy_points 
      WHERE player_id = ? 
      AND match_id IN (
        SELECT id FROM matches 
        WHERE id IN (
          SELECT match_id FROM match_squads 
          WHERE team_id != ? AND match_id IN (
            SELECT match_id FROM match_squads WHERE team_id = ?
          )
        )
      )
    `;

      const [oppositionPoints] = await db.execute(oppositionQuery, [
        playerId,
        playerTeamId,
        playerTeamId,
      ]);

      const dreamTeamQuery = `SELECT COUNT(*) as in_dream_team, SUM(is_captain) as captain_count, SUM(is_vice_captain) as vice_captain_count FROM match_dream_teams WHERE player_id = ?`;
      const [dreamTeam] = await db.execute(dreamTeamQuery, [playerId]);

      playerStats.push({
        player_id: playerId,
        player_name: player.player_name,
        team_name: player.team_name,
        role: player.role,
        total_points: overallPoints[0].total_points || 0,
        avg_points: overallPoints[0].avg_points || 0,
        total_matches: overallPoints[0].total_matches || 0,
        avg_points_venue: venuePoints[0].avg_points_venue || 0,
        avg_points_opposition: oppositionPoints[0].avg_points_opposition || 0,
        in_dream_team: dreamTeam[0].in_dream_team || 0,
        captain_count: dreamTeam[0].captain_count || 0,
        vice_captain_count: dreamTeam[0].vice_captain_count || 0,
      });
    }

    playerStats.sort((a, b) => b.total_points - a.total_points);

    playerStats = playerStats.map((player, index) => ({
      ...player,
      player_rank: index + 1,
      bottom_rank: playerStats.length - index,
      avg_position_rank: Math.round(
        (index + 1 + (playerStats.length - index)) / 2
      ),
      avg_team_rank: Math.round((index + 1) / 2),
    }));

    res.json(playerStats);
  } catch (error) {
    console.error("Error fetching player stats:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/player-stats-last-match", async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id)
      return res.status(400).json({ error: "match_id is required" });

    const venueQuery = `SELECT venue_id FROM matches WHERE id = ?`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    const venue_id = venueResult[0]?.venue_id;

    const squadQuery = `
    SELECT ms.player_id, ms.team_id, mpf.player_name, t.name as team_name, mpf.role
    FROM match_squads ms
    JOIN match_fantasy_points mpf ON ms.player_id = mpf.player_id AND ms.match_id = mpf.match_id
    JOIN teams t ON ms.team_id = t.id
    WHERE ms.match_id = ?`;
    const [squadPlayers] = await db.execute(squadQuery, [match_id]);

    let playerStats = [];

    for (const player of squadPlayers) {
      const playerId = player.player_id;
      const playerTeamId = player.team_id;

      const lastMatchQuery = `
        SELECT SUM(point) as total_points, AVG(point) as avg_points, COUNT(DISTINCT match_id) as total_matches 
        FROM match_fantasy_points 
        WHERE player_id = ? AND match_id = ?`;
      const [overallPoints] = await db.execute(lastMatchQuery, [
        playerId,
        match_id,
      ]);

      const venuePointsQuery = `
        SELECT AVG(point) as avg_points_venue 
        FROM match_fantasy_points 
        WHERE player_id = ? AND match_id = ?`;
      const [venuePoints] = await db.execute(venuePointsQuery, [
        playerId,
        match_id,
      ]);

      const oppositionQuery = `
        SELECT AVG(point) as avg_points_opposition 
        FROM match_fantasy_points 
        WHERE player_id = ? AND match_id = ?`;
      const [oppositionPoints] = await db.execute(oppositionQuery, [
        playerId,
        match_id,
      ]);

      const dreamTeamQuery = `
        SELECT COUNT(*) as in_dream_team, SUM(is_captain) as captain_count, SUM(is_vice_captain) as vice_captain_count 
        FROM match_dream_teams 
        WHERE player_id = ? AND match_id = ?`;
      const [dreamTeam] = await db.execute(dreamTeamQuery, [
        playerId,
        match_id,
      ]);

      playerStats.push({
        player_id: playerId,
        player_name: player.player_name,
        team_name: player.team_name,
        role: player.role,
        total_points: overallPoints[0].total_points || 0,
        avg_points: overallPoints[0].avg_points || 0,
        total_matches: overallPoints[0].total_matches || 0,
        avg_points_venue: venuePoints[0].avg_points_venue || 0,
        avg_points_opposition: oppositionPoints[0].avg_points_opposition || 0,
        in_dream_team: dreamTeam[0].in_dream_team || 0,
        captain_count: dreamTeam[0].captain_count || 0,
        vice_captain_count: dreamTeam[0].vice_captain_count || 0,
      });
    }

    playerStats.sort((a, b) => b.total_points - a.total_points);
    playerStats = playerStats.map((player, index) => ({
      ...player,
      player_rank: index + 1,
      bottom_rank: playerStats.length - index,
      avg_position_rank: Math.round(
        (index + 1 + (playerStats.length - index)) / 2
      ),
      avg_team_rank: Math.round((index + 1) / 2),
    }));

    res.json(playerStats);
  } catch (error) {
    console.error("Error fetching player stats:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/player-stats-last5", async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id)
      return res.status(400).json({ error: "match_id is required" });

    const venueQuery = `SELECT venue_id FROM matches WHERE id = ?`;
    const [venueResult] = await db.execute(venueQuery, [match_id]);
    const venue_id = venueResult[0]?.venue_id;

    const squadQuery = `
    SELECT ms.player_id, ms.team_id, mpf.player_name, t.name as team_name, mpf.role
    FROM match_squads ms
    JOIN match_fantasy_points mpf ON ms.player_id = mpf.player_id AND ms.match_id = mpf.match_id
    JOIN teams t ON ms.team_id = t.id
    WHERE ms.match_id = ?`;
    const [squadPlayers] = await db.execute(squadQuery, [match_id]);

    let playerStats = [];

    for (const player of squadPlayers) {
      const playerId = player.player_id;
      const playerTeamId = player.team_id;

      const last5MatchesQuery = `
        SELECT SUM(point) as total_points, AVG(point) as avg_points, COUNT(DISTINCT match_id) as total_matches 
        FROM (
          SELECT * FROM match_fantasy_points WHERE player_id = ? ORDER BY match_id DESC LIMIT 5
        ) as recent_matches`;
      const [overallPoints] = await db.execute(last5MatchesQuery, [playerId]);

      const venuePointsQuery = `
        SELECT AVG(point) as avg_points_venue 
        FROM match_fantasy_points 
        WHERE player_id = ? 
        AND match_id IN (
          SELECT id FROM matches WHERE venue_id = ?
        ) 
        ORDER BY match_id DESC LIMIT 5`;
      const [venuePoints] = await db.execute(venuePointsQuery, [
        playerId,
        venue_id,
      ]);

      const oppositionQuery = `
        SELECT AVG(point) as avg_points_opposition 
        FROM match_fantasy_points 
        WHERE player_id = ? 
        AND match_id IN (
          SELECT match_id FROM match_squads 
          WHERE team_id != ? AND match_id IN (
            SELECT match_id FROM match_squads WHERE team_id = ?
          )
        ) 
        ORDER BY match_id DESC LIMIT 5`;
      const [oppositionPoints] = await db.execute(oppositionQuery, [
        playerId,
        playerTeamId,
        playerTeamId,
      ]);

      const dreamTeamQuery = `
        SELECT COUNT(*) as in_dream_team, SUM(is_captain) as captain_count, SUM(is_vice_captain) as vice_captain_count 
        FROM match_dream_teams 
        WHERE player_id = ? 
        ORDER BY match_id DESC LIMIT 5`;
      const [dreamTeam] = await db.execute(dreamTeamQuery, [playerId]);

      playerStats.push({
        player_id: playerId,
        player_name: player.player_name,
        team_name: player.team_name,
        role: player.role,
        total_points: overallPoints[0].total_points || 0,
        avg_points: overallPoints[0].avg_points || 0,
        total_matches: overallPoints[0].total_matches || 0,
        avg_points_venue: venuePoints[0].avg_points_venue || 0,
        avg_points_opposition: oppositionPoints[0].avg_points_opposition || 0,
        in_dream_team: dreamTeam[0].in_dream_team || 0,
        captain_count: dreamTeam[0].captain_count || 0,
        vice_captain_count: dreamTeam[0].vice_captain_count || 0,
      });
    }

    playerStats.sort((a, b) => b.total_points - a.total_points);
    playerStats = playerStats.map((player, index) => ({
      ...player,
      player_rank: index + 1,
      bottom_rank: playerStats.length - index,
      avg_position_rank: Math.round(
        (index + 1 + (playerStats.length - index)) / 2
      ),
      avg_team_rank: Math.round((index + 1) / 2),
    }));

    res.json(playerStats);
  } catch (error) {
    console.error("Error fetching player stats:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));






// -------------------------------key insight --------------------------------

app.get('/key-insight', async (req, res) => {
  try {
    const { match_id } = req.query;
    if (!match_id) return res.status(400).json({ error: 'match_id is required' });

    const squadQuery = `
      SELECT ms.player_id, ms.team_id, t.name as team_name, 
             p.first_name as player_name, p.playing_role
      FROM match_squads ms
      JOIN players p ON ms.player_id = p.id
      JOIN teams t ON ms.team_id = t.id
      WHERE ms.match_id = ?`;
    const [squadPlayers] = await db.execute(squadQuery, [match_id]);

    let playerStats = [];

    for (const player of squadPlayers) {
      const playerId = player.player_id;

      const last5MatchesQuery = `
        SELECT pfp.point AS points
        FROM match_fantasy_points pfp
        WHERE pfp.player_id = ?
        ORDER BY pfp.match_id DESC LIMIT 5`;
      const [playerData] = await db.execute(last5MatchesQuery, [playerId]);

      const total_matches = playerData.length;
      const total_points = playerData.reduce((acc, curr) => acc + curr.points, 0);
      const avg_points = total_matches > 0 ? total_points / total_matches : 0;

      playerStats.push({
        player_id: playerId,
        player_name: player.player_name || 'N/A',
        team_name: player.team_name || 'N/A',
        playing_role: player.playing_role || 'N/A',
        total_points,
        avg_points,
        total_matches
      });
    }

    playerStats.sort((a, b) => b.total_points - a.total_points);

    const suggestedPlayers = playerStats.slice(0, 5);
    const topBatters = playerStats.filter(p => p.playing_role.toLowerCase().includes('bat')).slice(0, 5);
    const topBowlers = playerStats.filter(p => p.playing_role.toLowerCase().includes('bowl')).slice(0, 5);
    const xFactorPlayers = [
      ...playerStats.filter(p => p.playing_role.toLowerCase().includes('bat')).slice(0, 2),
      ...playerStats.filter(p => p.playing_role.toLowerCase().includes('all')).slice(0, 2),
      ...playerStats.filter(p => p.playing_role.toLowerCase().includes('bowl')).slice(0, 2),
    ];

    res.json({
      suggested_players: suggestedPlayers,
      top_batting_players: topBatters,
      top_bowling_players: topBowlers,
      x_factor_players: xFactorPlayers
    });

  } catch (error) {
    console.error('Error fetching key insights:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});







// --------------------captain vice captain home page-------------------------------

app.get("/match/:match_id/captains", async (req, res) => {
  try {
    const { match_id } = req.params;

    // 🔹 Fetch match_id using api_id
    const matchQuery = `
      SELECT m.id AS match_id, m.api_id 
      FROM matches m
      WHERE m.api_id = ?
    `;
    const [matchData] = await db.execute(matchQuery, [match_id]);

    if (matchData.length === 0) {
      return res.status(404).json({ message: "Match not found" });
    }

    const match_id_actual = matchData[0].match_id;

    // 🔹 Fetch squad players for today's match
    const squadQuery = `
      SELECT ms.player_id, p.first_name, p.last_name, p.short_name, 
             p.playing_role, ms.role_str, t.name AS team_name, t.short_name AS team_short
      FROM match_squads ms
      JOIN players p ON ms.player_id = p.id
      JOIN teams t ON ms.team_id = t.id
      WHERE ms.match_id = ?
    `;
    const [squadPlayers] = await db.execute(squadQuery, [match_id_actual]);

    if (squadPlayers.length === 0) {
      return res.status(404).json({ message: "No players found in squads" });
    }

    let playerStats = [];

    for (const player of squadPlayers) {
      const playerId = player.player_id;

      // 🔹 Fetch total fantasy points in last 5 matches
      const last5MatchesQuery = `
        SELECT SUM(point) as total_points, AVG(point) as avg_points, COUNT(DISTINCT match_id) as total_matches 
        FROM (
          SELECT * FROM match_fantasy_points WHERE player_id = ? ORDER BY match_id DESC LIMIT 5
        ) as recent_matches`;
      const [overallPoints] = await db.execute(last5MatchesQuery, [playerId]);

      playerStats.push({
        player_id: playerId,
        player_name: `${player.first_name} ${player.last_name || ""}`.trim(),
        short_name: player.short_name,
        team_name: player.team_name,  // 🔹 Team name included
        team_short: player.team_short,  // 🔹 Short team name included
        playing_role: player.playing_role,
        role_str: player.role_str,
        total_points: overallPoints[0].total_points || 0,
        avg_points: overallPoints[0].avg_points || 0,
        total_matches: overallPoints[0].total_matches || 0,
      });
    }

    // 🔹 Sort players based on total fantasy points (highest first)
    playerStats.sort((a, b) => b.total_points - a.total_points);

    // 🔹 Select the **top player as Captain** and **2nd best as Vice-Captain**
    const captain = playerStats.length > 0 ? playerStats[0] : null;
    const viceCaptain = playerStats.length > 1 ? playerStats[1] : null;

    res.json({
      match_id: match_id_actual,
      api_id: match_id,
      captain,
      vice_captain: viceCaptain,
    });
  } catch (error) {
    console.error("❌ Error fetching captains:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});


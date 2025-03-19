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
    let { per_page = 800, page = 1 } = req.query;

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
// app.get("/match/:match_id/scorecard", async (req, res) => {
//   try {
//     const { match_id } = req.params;

//     // 🔹 Fetch Match Details
//     const matchQuery = `
//       SELECT 
//         m.id AS match_id, m.name AS match_title, 
//         t1.id AS teamA_id, t1.name AS teamA_name, t1.short_name AS teamA_short, t1.logo_url AS teamA_logo,
//         t2.id AS teamB_id, t2.name AS teamB_name, t2.short_name AS teamB_short, t2.logo_url AS teamB_logo
//       FROM matches m
//       JOIN teams t1 ON m.team_1 = t1.id
//       JOIN teams t2 ON m.team_2 = t2.id
//       WHERE m.id = ?
//     `;
//     const [matchData] = await db.execute(matchQuery, [match_id]);

//     if (matchData.length === 0) {
//       return res.status(404).json({ message: "Match not found" });
//     }

//     // 🔹 Fetch Innings Data
//     const inningsQuery = `
//       SELECT 
//         i.id AS inning_id, i.number AS inning_number, i.batting_team_id, 
//         t.name AS team_name, i.scores, i.score_runs, i.scores_full
//       FROM match_innings i
//       JOIN teams t ON i.batting_team_id = t.id
//       WHERE i.match_id = ?
//       ORDER BY i.number
//     `;
//     const [inningsData] = await db.execute(inningsQuery, [match_id]);

//     // 🔹 Fetch Batting Data from `match_inning_batters`
//     const battingQuery = `
//       SELECT 
//         b.id AS batting_id, b.match_inning_id, p.first_name, p.last_name, 
//         b.runs, b.balls_faced AS balls, b.fours, b.sixes, b.strike_rate, 
//         b.how_out, p.image AS player_image
//       FROM match_inning_batters b
//       JOIN players p ON b.batsman_id = p.id
//       WHERE b.match_inning_id IN (SELECT id FROM match_innings WHERE match_id = ?)
//       ORDER BY b.match_inning_id, b.id
//     `;
//     const [battingData] = await db.execute(battingQuery, [match_id]);

//     // 🔹 Fetch Bowling Data from `match_inning_bowlers`
//     const bowlingQuery = `
//       SELECT 
//         bo.id AS bowling_id, bo.match_inning_id, p.first_name, p.last_name, 
//         bo.overs, bo.runs_conceded AS runs, bo.wickets, bo.econ AS economy, 
//         p.image AS player_image
//       FROM match_inning_bowlers bo
//       JOIN players p ON bo.bowler_id = p.id
//       WHERE bo.match_inning_id IN (SELECT id FROM match_innings WHERE match_id = ?)
//       ORDER BY bo.match_inning_id, bo.id
//     `;
//     const [bowlingData] = await db.execute(bowlingQuery, [match_id]);

//     // 🔹 Fetch Fall of Wicket Data from `match_inning_fows`
//     const fowQuery = `
//       SELECT 
//         f.match_inning_id, p.first_name, p.last_name, f.runs, f.balls, 
//         f.how_out, f.score_at_dismissal, f.overs_at_dismissal
//       FROM match_inning_fows f
//       JOIN players p ON f.batsman_id = p.id
//       WHERE f.match_inning_id IN (SELECT id FROM match_innings WHERE match_id = ?)
//       ORDER BY f.match_inning_id, f.number
//     `;
//     const [fowData] = await db.execute(fowQuery, [match_id]);

//     // 🔹 Structure Response
//     const innings = inningsData.map((inning) => ({
//       inning_number: inning.inning_number,
//       team_name: inning.team_name,
//       scores: inning.scores,
//       runs: inning.score_runs,
//       scores_full: inning.scores_full,
//       batting: battingData
//         .filter((b) => b.match_inning_id === inning.inning_id)
//         .map((b) => ({
//           player_name: `${b.first_name} ${b.last_name}`,
//           runs: b.runs,
//           balls: b.balls,
//           fours: b.fours,
//           sixes: b.sixes,
//           strike_rate: b.strike_rate,
//           how_out: b.how_out,
//           player_image: b.player_image,
//         })),
//       bowling: bowlingData
//         .filter((b) => b.match_inning_id === inning.inning_id)
//         .map((b) => ({
//           player_name: `${b.first_name} ${b.last_name}`,
//           overs: b.overs,
//           runs: b.runs,
//           wickets: b.wickets,
//           economy: b.economy,
//           player_image: b.player_image,
//         })),
//       fall_of_wickets: fowData
//         .filter((f) => f.match_inning_id === inning.inning_id)
//         .map((f) => ({
//           player_name: `${f.first_name} ${f.last_name}`,
//           runs: f.runs,
//           balls: f.balls,
//           how_out: f.how_out,
//           score_at_dismissal: f.score_at_dismissal,
//           overs_at_dismissal: f.overs_at_dismissal,
//         })),
//     }));

//     res.json({
//       match_id: matchData[0].match_id,
//       match_title: matchData[0].match_title,
//       teams: {
//         teamA: {
//           id: matchData[0].teamA_id,
//           name: matchData[0].teamA_name,
//           short_name: matchData[0].teamA_short,
//           logo_url: matchData[0].teamA_logo,
//         },
//         teamB: {
//           id: matchData[0].teamB_id,
//           name: matchData[0].teamB_name,
//           short_name: matchData[0].teamB_short,
//           logo_url: matchData[0].teamB_logo,
//         },
//       },
//       innings,
//     });
//   } catch (error) {
//     console.error("❌ Error fetching scorecard:", error.message);
//     res.status(500).json({ message: "Server error" });
//   }
// });

app.get("/match/:match_id/scorecard", async (req, res) => {
  try {
    const { match_id } = req.params;

    // 🔹 Fetch Match Details using api_id
    const matchQuery = `
      SELECT 
        m.id AS match_id, m.api_id, m.name AS match_title, 
        t1.id AS teamA_id, t1.name AS teamA_name, t1.short_name AS teamA_short, t1.logo_url AS teamA_logo,
        t2.id AS teamB_id, t2.name AS teamB_name, t2.short_name AS teamB_short, t2.logo_url AS teamB_logo
      FROM matches m
      JOIN teams t1 ON m.team_1 = t1.id
      JOIN teams t2 ON m.team_2 = t2.id
      WHERE m.api_id = ?
    `;

    const [matchData] = await db.execute(matchQuery, [match_id]);

    if (matchData.length === 0) {
      return res.status(404).json({ message: "Match not found" });
    }

    const actual_match_id = matchData[0].match_id; // Fetch the actual match_id

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
    const [inningsData] = await db.execute(inningsQuery, [actual_match_id]);

    // 🔹 Fetch Batting Data
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
    const [battingData] = await db.execute(battingQuery, [actual_match_id]);

    // 🔹 Fetch Bowling Data
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
    const [bowlingData] = await db.execute(bowlingQuery, [actual_match_id]);

    // 🔹 Fetch Fall of Wicket Data
    const fowQuery = `
      SELECT 
        f.match_inning_id, p.first_name, p.last_name, f.runs, f.balls, 
        f.how_out, f.score_at_dismissal, f.overs_at_dismissal
      FROM match_inning_fows f
      JOIN players p ON f.batsman_id = p.id
      WHERE f.match_inning_id IN (SELECT id FROM match_innings WHERE match_id = ?)
      ORDER BY f.match_inning_id, f.number
    `;
    const [fowData] = await db.execute(fowQuery, [actual_match_id]);

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
      api_id: matchData[0].api_id,
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




app.get("/match/:match_id/player-stats-table", async (req, res) => {
  try {
    const { match_id } = req.params; // This is actually the api_id

    // 🔹 Fetch `id` (our internal match ID) using `api_id`
    const matchQuery = `SELECT id FROM matches WHERE api_id = ?`;
    const [matchData] = await db.execute(matchQuery, [match_id]);

    if (matchData.length === 0) {
      return res.status(404).json({ message: "Match not found" });
    }
    const internal_match_id = matchData[0].id;

    // 🔹 Fetch Squads
    const squadQuery = `
      SELECT ms.team_id, p.id AS player_id, p.first_name, 
             p.short_name, p.playing_role, t.name AS team_name
      FROM match_squads ms
      JOIN players p ON ms.player_id = p.id
      JOIN teams t ON ms.team_id = t.id
      WHERE ms.match_id = ?
    `;
    const [squadData] = await db.execute(squadQuery, [internal_match_id]);

    if (squadData.length === 0) {
      return res.status(404).json({ message: "No players found in squads" });
    }

    // 🔹 Fetch Last 10 Matches for Each Player & Calculate Fantasy Points & DT%
    const playerStats = await Promise.all(
      squadData.map(async (player) => {
        // Fetch last 10 matches for the player (Workaround: Use ORDER BY and fetch IDs first)
        const lastMatchesQuery = `
          SELECT match_id 
          FROM match_fantasy_points 
          WHERE player_id = ? 
          ORDER BY match_id DESC 
          LIMIT 10
        `;
        const [lastMatches] = await db.execute(lastMatchesQuery, [player.player_id]);

        if (lastMatches.length === 0) {
          return {
            player_id: player.player_id,
            player_name: player.first_name,
            short_name: player.short_name,
            playing_role: player.playing_role,
            team_name: player.team_name,
            total_matches: 0,
            total_fantasy_points: 0,
            dt_percentage: "0.00",
          };
        }

        // Extract match IDs for the last 10 matches
        const lastMatchIds = lastMatches.map((m) => m.match_id);

        // Fetch total fantasy points
        const fantasyPointsQuery = `
          SELECT SUM(point) AS total_points 
          FROM match_fantasy_points 
          WHERE player_id = ? AND match_id IN (${lastMatchIds.join(",")})
        `;
        const [fantasyPointsData] = await db.execute(fantasyPointsQuery, [player.player_id]);

        const totalFantasyPoints = fantasyPointsData[0].total_points || 0;

        // Fetch Dream Team appearances separately
        const dreamTeamQuery = `
          SELECT COUNT(*) AS dream_team_count 
          FROM match_dream_teams 
          WHERE player_id = ? AND match_id IN (${lastMatchIds.join(",")})
        `;
        const [dreamTeamData] = await db.execute(dreamTeamQuery, [player.player_id]);

        const dreamTeamAppearances = dreamTeamData[0].dream_team_count || 0;
        const dtPercentage = lastMatches.length > 0 ? ((dreamTeamAppearances / lastMatches.length) * 100).toFixed(2) : 0;

        return {
          player_id: player.player_id,
          player_name: player.first_name, // No last_name
          short_name: player.short_name,
          playing_role: player.playing_role,
          team_name: player.team_name,
          total_matches: lastMatches.length,
          total_fantasy_points: totalFantasyPoints,
          dt_percentage: dtPercentage,
        };
      })
    );

    // 🔹 Sort players by Total Fantasy Points (Descending Order)
    const sortedPlayerStats = playerStats.sort((a, b) => b.total_fantasy_points - a.total_fantasy_points);

    res.json({ match_id, internal_match_id, player_stats: sortedPlayerStats });
  } catch (error) {
    console.error("❌ Error fetching player stats:", error.message);
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
      return res
        .status(400)
        .json({ error: "match_id and statType are required." });
    }

    // Convert `api_id` to `internal_match_id`
    const matchQuery = `SELECT id FROM matches WHERE api_id = ?`;
    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (matchResult.length === 0) {
      return res.status(404).json({ error: "Match not found." });
    }

    const internal_match_id = matchResult[0].id;

    // ✅ Mapping of statType to SQL Fields (Fixed WicketsTaken and AverageFantasyPoints)
    const statFieldMap = {
      TotalFantasyPoints: "COALESCE(SUM(pfp.point), 0) AS total_fantasy_points",
      
      AverageFantasyPoints: `
        COALESCE(
          SUM(pfp.point) / NULLIF(COUNT(DISTINCT pfp.match_id), 0), 0
        ) AS avg_fantasy_points
      `, // ✅ Fixed the division to count distinct matches correctly

      average_rating: "COALESCE(AVG(pfp.rating), 0) AS average_rating",
      
      RunsScored: "COALESCE(SUM(bat.runs), 0) AS total_runs",
      
      WicketsTaken: `
        COALESCE(SUM(bowl.wickets), 0) AS total_wickets
      `, // ✅ Ensured wickets are summed correctly from `match_inning_bowlers`
      
      DreamTeamAppearances: "COALESCE(COUNT(DISTINCT mdt.match_id), 0) AS dream_team_appearances",
      
      StrikeRate: `
        CASE 
          WHEN SUM(bat.balls_faced) > 0 
          THEN COALESCE((SUM(bat.runs) / SUM(bat.balls_faced)) * 100, 0) 
          ELSE 0 
        END AS strike_rate
      `,
    };

    if (!(statType in statFieldMap)) {
      return res.status(400).json({ error: "Invalid statType provided." });
    }

    const statField = statFieldMap[statType];

    // ✅ Corrected SQL Query
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
          COUNT(DISTINCT plm.match_id) AS matches_played,
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
          AND bat.match_inning_id IN (
              SELECT id FROM match_innings WHERE match_id = plm.match_id
          )
      LEFT JOIN match_inning_bowlers bowl  
          ON ps.player_id = bowl.bowler_id 
          AND bowl.match_inning_id IN (
              SELECT id FROM match_innings WHERE match_id = plm.match_id
          )
      LEFT JOIN match_dream_teams mdt  
          ON ps.player_id = mdt.player_id 
          AND plm.match_id = mdt.match_id
      GROUP BY ps.player_id, pfp.player_name, pfp.role, ps.team_id, t.name
      ORDER BY matches_played DESC;
    `;

    const [rows] = await db.execute(query, [internal_match_id]);

    res.json({ match_id, internal_match_id, stats: rows });
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

    // Convert `api_id` to `match_id`
    const matchQuery = `SELECT id FROM matches WHERE api_id = ?`;
    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (matchResult.length === 0) {
      return res.status(404).json({ error: "Match not found." });
    }

    const internal_match_id = matchResult[0].id; // ✅ Converted match_id

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

    const [rows] = await db.execute(query, [internal_match_id]);
    res.json({
      match_id,
      internal_match_id,
      stats: rows,
    });
  } catch (error) {
    console.error("❌ Error fetching data:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});


// --------------------------------------VENUE AND PITCH REPORT ------------------------------


app.get("/venue-pitch-report", async (req, res) => {
  try {
    const { match_id, type } = req.query;

    if (!match_id) {
      return res.status(400).json({ error: "match_id (api_id) is required." });
    }

    // ✅ Step 1: Convert `match_id` (api_id) to actual `id` and fetch venue_id
    const matchQuery = `SELECT id, venue_id FROM matches WHERE api_id = ? LIMIT 1;`;
    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (!matchResult.length || !matchResult[0].venue_id) {
      return res.status(404).json({ error: "Match not found or Venue ID is missing." });
    }

    const venue_id = matchResult[0].venue_id;
    let matchIds = [];
    let query = "";
    let params = [];

    if (type === "last") {
      // ✅ Fetch the most recent completed match with first innings
      const lastMatchQuery = `
        SELECT DISTINCT m.id 
        FROM matches m
        JOIN match_innings mi ON m.id = mi.match_id
        WHERE m.venue_id = ? 
        AND m.match_status_id = 2  -- ✅ Only completed matches
        AND mi.number = 1           -- ✅ Only matches where first innings exists
        ORDER BY m.date_start DESC 
        LIMIT 1;
      `;
      const [lastMatch] = await db.execute(lastMatchQuery, [venue_id]);

      if (!lastMatch.length) {
        return res.status(404).json({ error: "No recent completed match with first innings found at this venue." });
      }

      matchIds = [lastMatch[0].id];

    } else if (type === "last5") {
      // ✅ Fetch last 5 completed matches with first innings
      const lastMatchesQuery = `
        SELECT DISTINCT m.id 
        FROM matches m
        JOIN match_innings mi ON m.id = mi.match_id
        WHERE m.venue_id = ? 
        AND m.match_status_id = 2  
        AND mi.number = 1           
        ORDER BY m.date_start DESC 
        LIMIT 5;
      `;
      const [lastMatches] = await db.execute(lastMatchesQuery, [venue_id]);

      if (!lastMatches.length) {
        return res.status(404).json({ error: "No recent completed matches with first innings found at this venue." });
      }

      matchIds = lastMatches.map((m) => m.id);

    } else if (type === "overall") {
      // ✅ Fetch all completed matches with first innings at the venue
      const allMatchesQuery = `
        SELECT DISTINCT m.id 
        FROM matches m
        JOIN match_innings mi ON m.id = mi.match_id
        WHERE m.venue_id = ? 
        AND m.match_status_id = 2  
        AND mi.number = 1           
        ORDER BY m.date_start DESC;
      `;
      const [allMatches] = await db.execute(allMatchesQuery, [venue_id]);

      if (!allMatches.length) {
        return res.status(404).json({ error: "No completed matches with first innings at this venue." });
      }

      matchIds = allMatches.map((m) => m.id);

    } else {
      return res.status(400).json({ error: "Invalid type parameter. Use 'last', 'last5', or 'overall'." });
    }

    // ✅ Fetch First Inning Scores & Wickets
    query = `
      WITH first_innings_scores AS (
          SELECT match_id, SUM(score_runs) AS total_score, COUNT(*) AS match_count
          FROM match_innings
          WHERE match_id IN (${matchIds.map(() => "?").join(",")}) 
          AND number = 1
          GROUP BY match_id
      ),

      wickets_per_inning AS (
          SELECT mi.match_id, COUNT(f.batsman_id) AS total_wickets, COUNT(DISTINCT mi.match_id) AS match_count
          FROM match_innings mi
          LEFT JOIN match_inning_fows f ON mi.id = f.match_inning_id
          WHERE mi.match_id IN (${matchIds.map(() => "?").join(",")})
          AND mi.number = 1
          GROUP BY mi.match_id
      )

      SELECT 
          v.id AS venue_id,
          v.name AS venue_name,
          COALESCE(ROUND(SUM(fis.total_score) / NULLIF(SUM(fis.match_count), 0), 0), 0) AS avg_first_inning_score,
          COALESCE(ROUND(SUM(wpi.total_wickets) / NULLIF(SUM(wpi.match_count), 0), 0), 0) AS avg_wickets_lost

      FROM venues v
      LEFT JOIN first_innings_scores fis ON 1=1
      LEFT JOIN wickets_per_inning wpi ON 1=1
      WHERE v.id = ?
      GROUP BY v.id, v.name;
    `;

    params = [...matchIds, ...matchIds, venue_id];

    console.log("✅ SQL Query:", query);
    console.log("✅ SQL Params:", params);

    const [rows] = await db.execute(query, params);

    if (!rows.length) {
      return res.status(404).json({ error: "No data available for this venue." });
    }

    console.log("✅ Query Output:", rows[0]);
    res.json(rows[0]);

  } catch (error) {
    console.error("❌ Error fetching venue pitch report:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});




app.get("/venue-toss-trends", async (req, res) => {
  try {
    const { match_id, type } = req.query;

    if (!match_id) {
      return res.status(400).json({ error: "match_id (api_id) is required." });
    }

    // ✅ Step 1: Convert `api_id` to actual `id` and fetch venue_id
    const matchQuery = `SELECT id, venue_id FROM matches WHERE api_id = ? LIMIT 1;`;
    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (!matchResult.length || !matchResult[0].venue_id) {
      return res.status(404).json({ error: "Match not found or Venue ID is missing." });
    }

    const venue_id = matchResult[0].venue_id;
    let matchLimit = "";
    let matchCondition = "";

    // ✅ Define conditions based on type
    if (type === "last") {
      matchLimit = "LIMIT 1";
      matchCondition = "AND match_status_id = 2"; // ✅ Only completed matches
    } else if (type === "last5") {
      matchLimit = "LIMIT 5";
      matchCondition = "AND match_status_id = 2"; // ✅ Only completed matches
    } else if (type === "overall") {
      matchLimit = ""; // ✅ No limit for overall
      matchCondition = "AND match_status_id = 2"; // ✅ Only completed matches
    } else {
      return res.status(400).json({ error: "Invalid type parameter. Use 'last', 'last5', or 'overall'." });
    }

    // ✅ Fetch Matches Based on Type
    const matchesQuery = `
      SELECT id, toss, winning_team_id, team_1, team_2 
      FROM matches 
      WHERE venue_id = ? 
      ${matchCondition}
      ORDER BY date_start DESC 
      ${matchLimit};
    `;
    const [matches] = await db.execute(matchesQuery, [venue_id]);

    if (!matches.length) {
      return res.status(404).json({ error: "No completed matches found at this venue." });
    }

    // ✅ Process Toss Data
    let totalMatches = matches.length;
    let batFirst = 0, chase = 0;
    let winBattingFirst = 0, winChasing = 0;
    let tossWins = 0, tossLosses = 0;

    matches.forEach((match) => {
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

    // ✅ Handle Edge Cases (Prevent Division Errors)
    let choose_to_bat_first = batFirst ? ((batFirst / totalMatches) * 100).toFixed(2) + "%" : "0.00%";
    let choose_to_chase = chase ? ((chase / totalMatches) * 100).toFixed(2) + "%" : "0.00%";

    let win_batting_first = batFirst ? ((winBattingFirst / batFirst) * 100).toFixed(2) + "%" : "0.00%";
    let win_chasing = chase ? ((winChasing / chase) * 100).toFixed(2) + "%" : "0.00%";

    let win_percentage = ((tossWins / totalMatches) * 100).toFixed(2) + "%";
    let loss_percentage = ((tossLosses / totalMatches) * 100).toFixed(2) + "%";

    let tossTrends = {
      venue_id,
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

    // ✅ Return Data for Last Match Separately
    if (type === "last") {
      let lastMatch = matches[0];
      let tossWinner = lastMatch.toss.includes("bat") ? "Bat First" : "Chase";
      let tossWin = lastMatch.winning_team_id ? "Won" : "Lost";

      return res.json({
        venue_id,
        last_match_id: lastMatch.id,
        toss_decision: tossWinner,
        toss_win_result: tossWin,
      });
    }

    res.json(tossTrends);
  } catch (error) {
    console.error("❌ Error fetching venue toss trends:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});






app.get("/top-players-at-venue", async (req, res) => {
  try {
    const { match_id, type } = req.query;

    if (!match_id) {
      return res.status(400).json({ error: "match_id (api_id) is required." });
    }

    // ✅ Step 1: Convert `api_id` to actual `id` and fetch venue_id
    const matchQuery = `SELECT id, venue_id FROM matches WHERE api_id = ? LIMIT 1;`;
    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (!matchResult.length || !matchResult[0].venue_id) {
      return res.status(404).json({ error: "Match not found or Venue ID is missing." });
    }

    const venue_id = matchResult[0].venue_id;
    let matchCondition = "";
    let matchLimit = "";

    // ✅ Define match selection conditions based on type
    if (type === "last") {
      matchLimit = "LIMIT 1";
      matchCondition = "AND match_status_id = 2"; // ✅ Only completed matches
    } else if (type === "last5") {
      matchLimit = "LIMIT 5";
      matchCondition = "AND match_status_id = 2"; // ✅ Only completed matches
    } else if (type === "overall") {
      matchLimit = ""; // ✅ No limit for overall
      matchCondition = "AND match_status_id = 2"; // ✅ Only completed matches
    } else {
      return res.status(400).json({ error: "Invalid type parameter. Use 'last', 'last5', or 'overall'." });
    }

    // ✅ Fetch Matches Based on Type
    const matchesQuery = `
      SELECT id FROM matches 
      WHERE venue_id = ? 
      ${matchCondition}
      ORDER BY date_start DESC 
      ${matchLimit};
    `;
    const [matches] = await db.execute(matchesQuery, [venue_id]);

    if (!matches.length) {
      return res.status(404).json({ error: "No completed matches found at this venue." });
    }

    const matchIds = matches.map((m) => m.id);

    // ✅ Fetch Player Squads
    const squadQuery = `
      SELECT DISTINCT player_id FROM match_squads 
      WHERE match_id IN (${matchIds.map(() => "?").join(",")});
    `;
    const [squadPlayers] = await db.execute(squadQuery, matchIds);

    if (!squadPlayers.length) {
      return res.status(404).json({ error: "No squad data found for these matches." });
    }

    let playerData = [];

    // ✅ Fetch Fantasy Points for Players
    for (const player of squadPlayers) {
      const playerId = player.player_id;

      // Fetch player's fantasy points from the relevant matches
      const fantasyPointsQuery = `
        SELECT player_id, player_name, SUM(point) AS total_fantasy_points
        FROM match_fantasy_points 
        WHERE match_id IN (${matchIds.map(() => "?").join(",")}) 
        AND player_id = ?
        GROUP BY player_id, player_name
        ORDER BY total_fantasy_points DESC;
      `;
      const [pointsData] = await db.execute(fantasyPointsQuery, [...matchIds, playerId]);

      if (pointsData.length > 0) {
        playerData.push({
          player_id: pointsData[0].player_id,
          player_name: pointsData[0].player_name,
          fantasy_points: pointsData[0].total_fantasy_points,
        });
      } else {
        playerData.push({
          player_id: playerId,
          status: "No fantasy points recorded",
        });
      }
    }

    // ✅ Sort Players by Fantasy Points in Descending Order
    playerData = playerData.sort(
      (a, b) => (b.fantasy_points || 0) - (a.fantasy_points || 0)
    );

    res.json({
      venue_id,
      matches_analyzed: matchIds.length,
      players: playerData,
    });
  } catch (error) {
    console.error("❌ Error fetching top players at venue:", error.message);
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





app.get("/top-players-venue2", async (req, res) => {
  try {
    let { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    // ✅ Convert api_id to match_id if needed
    const matchQuery = `SELECT id FROM matches WHERE api_id = ? LIMIT 1`;
    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (matchResult.length > 0) {
      match_id = matchResult[0].id;
    }

    // ✅ Fetch top players at the venue using match_id
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
              ps.team_id,
              pfp.point AS fantasy_points
          FROM match_fantasy_points pfp
          JOIN matches m ON pfp.match_id = m.id
          JOIN player_squads ps ON pfp.player_id = ps.player_id
          WHERE m.venue_id = (SELECT venue_id FROM venue_info)
          ORDER BY m.date_start DESC
      ),

      player_total_points AS (
          -- ✅ Aggregate total points and count matches played at this venue
          SELECT 
              pfp.player_id,
              pfp.player_name,
              pfp.team_id,
              t.name AS team_name,
              SUM(pfp.fantasy_points) AS total_points,
              COUNT(DISTINCT pfp.match_id) AS matches_played  -- ✅ Count distinct matches
          FROM player_venue_matches pfp
          JOIN teams t ON pfp.team_id = t.id
          GROUP BY pfp.player_id, pfp.player_name, pfp.team_id, t.name
      )

      -- ✅ Fetch top 5 players with highest fantasy points at this venue
      SELECT 
          ptp.player_id,
          ptp.player_name,
          ptp.team_id,
          ptp.team_name,
          ptp.total_points,
          ptp.matches_played  -- ✅ Return total matches played
      FROM player_total_points ptp
      ORDER BY total_points DESC
      LIMIT 5;
    `;

    const [results] = await db.execute(query, [match_id, match_id]);

    if (results.length === 0) {
      return res
        .status(404)
        .json({ message: "No top player data found for this venue" });
    }

    res.json({
      match_id: match_id,
      top_players: results.map((player) => ({
        player_id: player.player_id,
        player_name: player.player_name,
        team_id: player.team_id,
        team_name: player.team_name,
        total_points: player.total_points,
        matches_played: player.matches_played,  // ✅ Added total matches played
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











app.get("/match-insights", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ error: "match_id is required" });
    }

    // ✅ Step 1: Convert API ID to Match ID
    const matchQuery = `SELECT id, venue_id FROM matches WHERE api_id = ? LIMIT 1`;
    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (matchResult.length === 0) {
      return res.status(404).json({ error: "Match not found" });
    }

    const internal_match_id = matchResult[0].id;
    const venue_id = matchResult[0].venue_id;

    // ✅ Step 2: Fetch Squads for this Match
    const squadQuery = `
      SELECT ps.player_id, ps.team_id, t.name AS team_name, p.first_name, p.last_name, p.playing_role
      FROM match_squads ps
      JOIN teams t ON ps.team_id = t.id
      JOIN players p ON ps.player_id = p.id
      WHERE ps.match_id = ?
    `;
    const [squads] = await db.execute(squadQuery, [internal_match_id]);

    if (!squads.length) {
      return res.status(404).json({ error: "No squads found for this match" });
    }

    // ✅ Step 3: Fetch Fantasy Points and Matches Played
    const playerStatsQuery = `
      SELECT pfp.player_id, COUNT(DISTINCT pfp.match_id) AS matches_played, SUM(pfp.point) AS total_fantasy_points
      FROM match_fantasy_points pfp
      WHERE pfp.player_id IN (SELECT player_id FROM match_squads WHERE match_id = ?)
      GROUP BY pfp.player_id
    `;
    const [playerStats] = await db.execute(playerStatsQuery, [internal_match_id]);

    // ✅ Step 4: Fetch Batting Order (Sort by most innings played)
    const battingOrderQuery = `
      SELECT bat.batsman_id AS player_id, COUNT(bat.match_inning_id) AS innings_played
      FROM match_inning_batters bat
      WHERE bat.match_inning_id IN (SELECT id FROM match_innings WHERE match_id = ?)
      GROUP BY bat.batsman_id
      ORDER BY innings_played DESC
    `;
    const [battingOrderData] = await db.execute(battingOrderQuery, [internal_match_id]);

    // ✅ Step 5: Fetch Top Batters (Role: 'bat')
    const topBattingQuery = `
      SELECT pfp.player_id, SUM(pfp.run) AS total_runs
      FROM match_fantasy_points pfp
      WHERE pfp.player_id IN (SELECT player_id FROM match_squads WHERE match_id = ?)
      GROUP BY pfp.player_id
      ORDER BY total_runs DESC
      LIMIT 5;
    `;
    const [topBatters] = await db.execute(topBattingQuery, [internal_match_id]);

    // ✅ Step 6: Fetch Top Bowlers (Role: 'bowl')
    const topBowlingQuery = `
      SELECT pfp.player_id, SUM(pfp.wkts) AS total_wickets
      FROM match_fantasy_points pfp
      WHERE pfp.player_id IN (SELECT player_id FROM match_squads WHERE match_id = ?)
      GROUP BY pfp.player_id
      ORDER BY total_wickets DESC
      LIMIT 5;
    `;
    const [topBowlers] = await db.execute(topBowlingQuery, [internal_match_id]);

    // ✅ Step 7: Fetch Player X-Factor (All-rounders who played well in last match)
    const xFactorQuery = `
      SELECT pfp.player_id, SUM(pfp.run + pfp.wkts * 20) AS x_factor_points
      FROM match_fantasy_points pfp
      WHERE pfp.player_id IN (SELECT player_id FROM match_squads WHERE match_id = ?)
      GROUP BY pfp.player_id
      ORDER BY x_factor_points DESC
      LIMIT 5;
    `;
    const [xFactorPlayers] = await db.execute(xFactorQuery, [internal_match_id]);

    // ✅ Data Processing
    const playersMap = Object.fromEntries(
      squads.map((p) => [p.player_id, { ...p, matches_played: 0, total_fantasy_points: 0 }])
    );

    playerStats.forEach((stat) => {
      if (playersMap[stat.player_id]) {
        playersMap[stat.player_id].matches_played = stat.matches_played;
        playersMap[stat.player_id].total_fantasy_points = stat.total_fantasy_points;
      }
    });

    // ✅ Construct Response
    res.json({
      match_id,
      venue_id,
      suggested_players: Object.values(playersMap)
        .sort((a, b) => b.total_fantasy_points - a.total_fantasy_points)
        .slice(0, 5)
        .map((player) => ({
          player_id: player.player_id,
          player_name: `${player.first_name}`,
          team_id: player.team_id,
          team_name: player.team_name,
          matches_played: player.matches_played,
          total_fantasy_points: player.total_fantasy_points,
        })),
      top_batting: topBatters.map((player) => ({
        player_id: player.player_id,
        player_name: `${playersMap[player.player_id]?.first_name || ""}`,
        team_id: playersMap[player.player_id]?.team_id || null,
        team_name: playersMap[player.player_id]?.team_name || null,
        total_runs: player.total_runs,
      })),
      top_bowling: topBowlers.map((player) => ({
        player_id: player.player_id,
        player_name: `${playersMap[player.player_id]?.first_name || ""}`,
        team_id: playersMap[player.player_id]?.team_id || null,
        team_name: playersMap[player.player_id]?.team_name || null,
        total_wickets: player.total_wickets,
      })),
      player_x_factor: xFactorPlayers.map((player) => ({
        player_id: player.player_id,
        player_name: `${playersMap[player.player_id]?.first_name || ""}`,
        team_id: playersMap[player.player_id]?.team_id || null,
        team_name: playersMap[player.player_id]?.team_name || null,
        x_factor_points: player.x_factor_points,
      })),
    });

  } catch (error) {
    console.error("❌ Error fetching match insights:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});























// -----------------------------------------------------team stats ----------------------------------------

app.get("/team-vs-team", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ message: "match_id is required" });
    }

    // Step 1: Convert api_id to match_id
    const matchIdQuery = `SELECT id FROM matches WHERE api_id = ? LIMIT 1;`;
    const [matchResult] = await db.execute(matchIdQuery, [match_id]);

    if (!matchResult.length) {
      return res.status(404).json({ message: "Match not found for given api_id" });
    }

    const converted_match_id = matchResult[0].id;

    // Step 2: Fetch Team IDs, Names, and Logos (Fixed logo issue)
    const teamQuery = `
      SELECT 
        m.team_1, t1.name AS teamA_name, COALESCE(t1.logo_url, '') AS teamA_logo,
        m.team_2, t2.name AS teamB_name, COALESCE(t2.logo_url, '') AS teamB_logo
      FROM matches m
      JOIN teams t1 ON m.team_1 = t1.id
      JOIN teams t2 ON m.team_2 = t2.id
      WHERE m.id = ? 
      LIMIT 1;
    `;
    const [teamResult] = await db.execute(teamQuery, [converted_match_id]);

    if (!teamResult.length) {
      return res.status(404).json({ message: "Match details not found" });
    }

    const teamA = teamResult[0].team_1;
    const teamB = teamResult[0].team_2;
    const teamA_name = teamResult[0].teamA_name;
    const teamB_name = teamResult[0].teamB_name;
    const teamA_logo = teamResult[0].teamA_logo;
    const teamB_logo = teamResult[0].teamB_logo;

    // Step 3: Fetch Head-to-Head Matches
    const matchesQuery = `
      SELECT id, date_start, team_1, team_2, winning_team_id, win_margin
      FROM matches 
      WHERE ((team_1 = ? AND team_2 = ?) OR (team_1 = ? AND team_2 = ?))
        AND match_status_id = 2  -- Only Completed Matches
      ORDER BY date_start DESC;
    `;
    const [matches] = await db.execute(matchesQuery, [teamA, teamB, teamB, teamA]);

    if (!matches.length) {
      return res.status(404).json({ message: "No previous matches found between these teams" });
    }

    // Step 4: Calculate Win Stats
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

    // Step 5: Fetch Recent 5 Matches with Scores
    const recentMatchesQuery = `
      SELECT id, date_start, team_1, team_2, winning_team_id, win_margin
      FROM matches 
      WHERE ((team_1 = ? AND team_2 = ?) OR (team_1 = ? AND team_2 = ?))
        AND match_status_id = 2 
      ORDER BY date_start DESC 
      LIMIT 5;
    `;
    const [recentMatches] = await db.execute(recentMatchesQuery, [teamA, teamB, teamB, teamA]);

    const formattedRecentMatches = recentMatches.map((match) => ({
      match_date: match.date_start,
      teamA: {
        id: match.team_1,
        name: match.team_1 === teamA ? teamA_name : teamB_name,
        logo: match.team_1 === teamA ? teamA_logo : teamB_logo,
      },
      teamB: {
        id: match.team_2,
        name: match.team_2 === teamA ? teamA_name : teamB_name,
        logo: match.team_2 === teamA ? teamA_logo : teamB_logo,
      },
      result:
        match.winning_team_id === teamA
          ? `${teamA_name} won`
          : match.winning_team_id === teamB
          ? `${teamB_name} won`
          : "No Result",
      win_margin: match.win_margin || "N/A",
    }));

    res.json({
      teams: {
        teamA: {
          id: teamA,
          name: teamA_name,
          logo: teamA_logo,
          win_percentage: `${teamA_win_percentage}%`,
          total_wins: teamA_wins,
        },
        teamB: {
          id: teamB,
          name: teamB_name,
          logo: teamB_logo,
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

    // Step 1: Convert api_id to match_id
    const matchIdQuery = `SELECT id FROM matches WHERE api_id = ? LIMIT 1;`;
    const [matchResult] = await db.execute(matchIdQuery, [match_id]);

    if (!matchResult.length) {
      return res.status(404).json({ message: "Match not found for given api_id" });
    }

    const converted_match_id = matchResult[0].id;

    // Step 2: Fetch Team IDs and Names
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
    const [teamResult] = await db.execute(teamQuery, [converted_match_id]);

    if (!teamResult.length) {
      return res.status(404).json({ message: "Match details not found" });
    }

    const teamA = teamResult[0].team_1;
    const teamB = teamResult[0].team_2;
    const teamA_name = teamResult[0].teamA_name;
    const teamB_name = teamResult[0].teamB_name;

    // Step 3: Fetch Head-to-Head Matches
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
    console.error("❌ Error fetching team vs team stats:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});


// ------------------player overview-----------------------------



app.get("/player-stats", async (req, res) => {
  try {
    const { match_id } = req.query;  
    if (!match_id) return res.status(400).json({ error: "match_id is required" });

    // Step 1: Fetch actual match ID from matches using match_id (which is actually api_id)
    const matchQuery = `SELECT id, venue_id FROM matches WHERE api_id = ?`;
    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (!matchResult.length) return res.status(404).json({ error: "Match not found" });

    const actual_match_id = matchResult[0].id;
    const venue_id = matchResult[0].venue_id;

    // Step 2: Fetch squad details
    const squadQuery = `
      SELECT ms.player_id, ms.team_id, p.first_name, p.last_name, p.playing_role, t.name as team_name
      FROM match_squads ms
      JOIN players p ON ms.player_id = p.id
      JOIN teams t ON ms.team_id = t.id
      WHERE ms.match_id = ?;
    `;
    const [squadPlayers] = await db.execute(squadQuery, [actual_match_id]);

    if (!squadPlayers.length) return res.status(404).json({ error: "No squad data found" });

    // Step 3: Get player IDs
    const playerIds = squadPlayers.map(player => player.player_id);
    const playerIdsList = playerIds.length ? `(${playerIds.join(",")})` : "(NULL)";

    // Step 4: Fetch last completed match for all players
    const lastMatchQuery = `
      SELECT player_id, MAX(match_id) as last_match_id
      FROM match_fantasy_points 
      WHERE player_id IN ${playerIdsList} 
      AND match_id IN (SELECT id FROM matches WHERE match_status_id = 2) 
      GROUP BY player_id;
    `;
    const [lastMatches] = await db.execute(lastMatchQuery);
    const lastMatchMap = Object.fromEntries(lastMatches.map(m => [m.player_id, m.last_match_id]));

    // Step 5: Fetch last 5 completed matches for all players
    const last5MatchesQuery = `
      SELECT player_id, match_id FROM match_fantasy_points 
      WHERE player_id IN ${playerIdsList} 
      AND match_id IN (SELECT id FROM matches WHERE match_status_id = 2) 
      ORDER BY match_id DESC;
    `;
    const [last5Matches] = await db.execute(last5MatchesQuery);
    const last5MatchMap = {};
    last5Matches.forEach(({ player_id, match_id }) => {
      if (!last5MatchMap[player_id]) last5MatchMap[player_id] = [];
      if (last5MatchMap[player_id].length < 5) last5MatchMap[player_id].push(match_id);
    });

    // Step 6: Fetch overall (last 50 matches) for all players
    const overallMatchesQuery = `
      SELECT player_id, match_id FROM match_fantasy_points 
      WHERE player_id IN ${playerIdsList} 
      AND match_id IN (SELECT id FROM matches WHERE match_status_id = 2) 
      ORDER BY match_id DESC;
    `;
    const [overallMatches] = await db.execute(overallMatchesQuery);
    const overallMatchMap = {};
    overallMatches.forEach(({ player_id, match_id }) => {
      if (!overallMatchMap[player_id]) overallMatchMap[player_id] = [];
      if (overallMatchMap[player_id].length < 50) overallMatchMap[player_id].push(match_id);
    });

    // Step 7: Fetch all statistics in one query
    const fetchStats = async (matchIds) => {
      if (!matchIds.length) return { total_points: 0, avg_points: 0, total_matches: 0 };
      const query = `
        SELECT player_id, SUM(point) as total_points, AVG(point) as avg_points, COUNT(DISTINCT match_id) as total_matches
        FROM match_fantasy_points 
        WHERE player_id IN ${playerIdsList} 
        AND match_id IN (${matchIds.join(",")})
        GROUP BY player_id;
      `;
      const [stats] = await db.execute(query);
      return Object.fromEntries(stats.map(s => [s.player_id, s]));
    };

    // Fetch stats for last match, last 5 matches, and overall matches
    const lastMatchStats = await fetchStats(Object.values(lastMatchMap));
    const last5Stats = await fetchStats(Object.values(last5MatchMap).flat());
    const overallStats = await fetchStats(Object.values(overallMatchMap).flat());

    // Step 8: Fetch venue-based stats
    const venueStatsQuery = `
      SELECT player_id, AVG(point) as avg_points_venue 
      FROM match_fantasy_points 
      WHERE player_id IN ${playerIdsList} 
      AND match_id IN (SELECT id FROM matches WHERE venue_id = ?)
      GROUP BY player_id;
    `;
    const [venueStats] = await db.execute(venueStatsQuery, [venue_id]);
    const venueStatsMap = Object.fromEntries(venueStats.map(v => [v.player_id, v.avg_points_venue]));

    // Step 9: Fetch opposition stats
    const oppositionQuery = `
      SELECT player_id, AVG(point) as avg_points_opposition 
      FROM match_fantasy_points 
      WHERE player_id IN ${playerIdsList}
      AND match_id IN (
          SELECT id FROM matches 
          WHERE id IN (
              SELECT match_id FROM match_squads 
              WHERE team_id != (SELECT team_id FROM match_squads WHERE match_id = ? LIMIT 1)
          )
      )
      GROUP BY player_id;
    `;
    const [oppositionStats] = await db.execute(oppositionQuery, [actual_match_id]);
    const oppositionStatsMap = Object.fromEntries(oppositionStats.map(o => [o.player_id, o.avg_points_opposition]));

    // Step 10: Fetch dream team stats
    const dreamTeamQuery = `
      SELECT player_id, COUNT(*) as in_dream_team, SUM(is_captain) as captain_count, SUM(is_vice_captain) as vice_captain_count
      FROM match_dream_teams 
      WHERE player_id IN ${playerIdsList}
      GROUP BY player_id;
    `;
    const [dreamTeamStats] = await db.execute(dreamTeamQuery);
    const dreamTeamMap = Object.fromEntries(dreamTeamStats.map(d => [d.player_id, d]));

    // Step 11: Compile response
    let playerStats = squadPlayers.map(player => ({
      player_id: player.player_id,
      player_name: `${player.first_name}`,
      team_name: player.team_name,
      role: player.playing_role,

      last_match: lastMatchStats[player.player_id] || { total_points: 0, avg_points: 0, total_matches: 0 },
      last_5_matches: last5Stats[player.player_id] || { total_points: 0, avg_points: 0, total_matches: 0 },
      overall: overallStats[player.player_id] || { total_points: 0, avg_points: 0, total_matches: 0 },

      avg_points_venue: venueStatsMap[player.player_id] || 0,
      avg_points_opposition: oppositionStatsMap[player.player_id] || 0,

      in_dream_team: dreamTeamMap[player.player_id]?.in_dream_team || 0,
      captain_count: dreamTeamMap[player.player_id]?.captain_count || 0,
      vice_captain_count: dreamTeamMap[player.player_id]?.vice_captain_count || 0,
    }));

    res.json(playerStats);
  } catch (error) {
    console.error("Error fetching player stats:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});




app.get("/bowler-stats", async (req, res) => {
  try {
    const { match_id } = req.query;  
    if (!match_id) return res.status(400).json({ error: "match_id is required" });

    // Step 1: Fetch actual match ID from matches table
    const matchQuery = `SELECT id, venue_id FROM matches WHERE api_id = ?`;
    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (!matchResult.length) return res.status(404).json({ error: "Match not found" });

    const actual_match_id = matchResult[0].id;
    const venue_id = matchResult[0].venue_id;

    // Step 2: Fetch squad details (Only Bowlers)
    const squadQuery = `
      SELECT ms.player_id, ms.team_id, p.first_name, p.last_name, p.playing_role, p.bowling_style, t.name as team_name
      FROM match_squads ms
      JOIN players p ON ms.player_id = p.id
      JOIN teams t ON ms.team_id = t.id
      WHERE ms.match_id = ? AND p.playing_role = 'bowl';
    `;
    const [squadPlayers] = await db.execute(squadQuery, [actual_match_id]);

    if (!squadPlayers.length) return res.status(404).json({ error: "No bowler data found" });

    // Step 3: Get player IDs
    const playerIds = squadPlayers.map(player => player.player_id);
    const playerIdsList = playerIds.length ? `(${playerIds.join(",")})` : "(NULL)";

    // Step 4: Fetch last completed match for bowlers
    const lastMatchQuery = `
      SELECT player_id, MAX(match_id) as last_match_id
      FROM match_fantasy_points 
      WHERE player_id IN ${playerIdsList} 
      AND match_id IN (SELECT id FROM matches WHERE match_status_id = 2) 
      GROUP BY player_id;
    `;
    const [lastMatches] = await db.execute(lastMatchQuery);
    const lastMatchMap = Object.fromEntries(lastMatches.map(m => [m.player_id, m.last_match_id]));

    // Step 5: Fetch last 5 completed matches for bowlers
    const last5MatchesQuery = `
      SELECT player_id, match_id FROM match_fantasy_points 
      WHERE player_id IN ${playerIdsList} 
      AND match_id IN (SELECT id FROM matches WHERE match_status_id = 2) 
      ORDER BY match_id DESC;
    `;
    const [last5Matches] = await db.execute(last5MatchesQuery);
    const last5MatchMap = {};
    last5Matches.forEach(({ player_id, match_id }) => {
      if (!last5MatchMap[player_id]) last5MatchMap[player_id] = [];
      if (last5MatchMap[player_id].length < 5) last5MatchMap[player_id].push(match_id);
    });

    // Step 6: Fetch overall stats (last 50 matches) for bowlers
    const overallMatchesQuery = `
      SELECT player_id, match_id FROM match_fantasy_points 
      WHERE player_id IN ${playerIdsList} 
      AND match_id IN (SELECT id FROM matches WHERE match_status_id = 2) 
      ORDER BY match_id DESC;
    `;
    const [overallMatches] = await db.execute(overallMatchesQuery);
    const overallMatchMap = {};
    overallMatches.forEach(({ player_id, match_id }) => {
      if (!overallMatchMap[player_id]) overallMatchMap[player_id] = [];
      if (overallMatchMap[player_id].length < 50) overallMatchMap[player_id].push(match_id);
    });

    // Step 7: Fetch all bowling statistics
    const fetchStats = async (matchIds) => {
      if (!matchIds.length) return {};
      const query = `
        SELECT player_id, SUM(point) as total_points, AVG(point) as avg_points, COUNT(DISTINCT match_id) as total_matches
        FROM match_fantasy_points 
        WHERE player_id IN ${playerIdsList} 
        AND match_id IN (${matchIds.join(",")})
        GROUP BY player_id;
      `;
      const [stats] = await db.execute(query);
      return Object.fromEntries(stats.map(s => [s.player_id, s]));
    };

    // Fetch stats for last match, last 5 matches, and overall matches
    const lastMatchStats = await fetchStats(Object.values(lastMatchMap));
    const last5Stats = await fetchStats(Object.values(last5MatchMap).flat());
    const overallStats = await fetchStats(Object.values(overallMatchMap).flat());

    // Step 8: Fetch venue-based stats
    const venueStatsQuery = `
      SELECT player_id, AVG(point) as avg_points_venue 
      FROM match_fantasy_points 
      WHERE player_id IN ${playerIdsList} 
      AND match_id IN (SELECT id FROM matches WHERE venue_id = ?)
      GROUP BY player_id;
    `;
    const [venueStats] = await db.execute(venueStatsQuery, [venue_id]);
    const venueStatsMap = Object.fromEntries(venueStats.map(v => [v.player_id, v.avg_points_venue]));

    // Step 9: Fetch bowling stats from match_inning_bowlers table
    const bowlingStatsQuery = `
      SELECT bowler_id, AVG(overs) as avg_overs, SUM(wickets) as total_wickets, AVG(econ) as avg_fpts_bowling_1st
      FROM match_inning_bowlers 
      WHERE bowler_id IN ${playerIdsList} 
      GROUP BY bowler_id;
    `;
    const [bowlingStats] = await db.execute(bowlingStatsQuery);
    const bowlingStatsMap = Object.fromEntries(bowlingStats.map(b => [b.bowler_id, b]));

    // Step 10: Compile response
    let bowlerStats = squadPlayers.map(player => ({
      player_id: player.player_id,
      player_name: `${player.first_name}`,
      team_name: player.team_name,
      role: player.playing_role,
      bowling_style: player.bowling_style,

      last_match: lastMatchStats[player.player_id] || { total_points: 0, avg_points: 0, total_matches: 0 },
      last_5_matches: last5Stats[player.player_id] || { total_points: 0, avg_points: 0, total_matches: 0 },
      overall: overallStats[player.player_id] || { total_points: 0, avg_points: 0, total_matches: 0 },

      avg_points_venue: venueStatsMap[player.player_id] || 0,

      avg_fpts_bowling_1st: bowlingStatsMap[player.player_id]?.avg_fpts_bowling_1st || 0,
      total_wickets: bowlingStatsMap[player.player_id]?.total_wickets || 0,
      total_overs: bowlingStatsMap[player.player_id]?.avg_overs || 0,
    }));

    res.json(bowlerStats);
  } catch (error) {
    console.error("Error fetching bowler stats:", error.message);
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














// dream team

app.get("/match/:match_id/best-11-players", async (req, res) => {
  try {
    const { match_id } = req.params; // This is the api_id

    // 🔹 Get Internal Match ID
    const matchQuery = `SELECT id FROM matches WHERE api_id = ?`;
    const [matchData] = await db.execute(matchQuery, [match_id]);

    if (matchData.length === 0) {
      return res.status(404).json({ message: "Match not found" });
    }
    const internal_match_id = matchData[0].id;

    // 🔹 Fetch match squads
    const squadQuery = `
      SELECT ms.team_id, p.id AS player_id, p.first_name, 
             p.short_name, p.playing_role, t.name AS team_name
      FROM match_squads ms
      JOIN players p ON ms.player_id = p.id
      JOIN teams t ON ms.team_id = t.id
      WHERE ms.match_id = ?
    `;
    const [squadData] = await db.execute(squadQuery, [internal_match_id]);

    if (squadData.length === 0) {
      return res.status(404).json({ message: "No players found in squads" });
    }

    // 🔹 Fetch last match and fantasy points for each player
    const playerStatsPromises = squadData.map(async (player) => {
      // Find last match the player played
      const lastMatchQuery = `
        SELECT match_id 
        FROM match_fantasy_points 
        WHERE player_id = ? 
        ORDER BY match_id DESC 
        LIMIT 1
      `;
      const [lastMatch] = await db.execute(lastMatchQuery, [player.player_id]);

      if (lastMatch.length === 0) {
        return null; // No last match found
      }
      const lastMatchId = lastMatch[0].match_id;

      // Fetch fantasy points and rating from last match
      const fantasyPointsQuery = `
        SELECT point AS total_fantasy_points, rating 
        FROM match_fantasy_points 
        WHERE player_id = ? AND match_id = ?
      `;
      const [fantasyData] = await db.execute(fantasyPointsQuery, [player.player_id, lastMatchId]);

      if (fantasyData.length === 0) {
        return null;
      }

      return {
        player_id: player.player_id,
        player_name: player.first_name, // No last_name
        short_name: player.short_name,
        playing_role: player.playing_role,
        team_name: player.team_name,
        total_fantasy_points: fantasyData[0].total_fantasy_points || 0,
        rating: Math.min(fantasyData[0].rating || 0, 10) // Rating is capped at 10
      };
    });

    // Wait for all player stats to be retrieved
    const playerStats = (await Promise.all(playerStatsPromises)).filter((p) => p !== null);

    // 🔹 Sort by Total Fantasy Points (Descending), then Rating (Descending)
    const sortedPlayerStats = playerStats.sort(
      (a, b) =>
        b.total_fantasy_points - a.total_fantasy_points || // Sort by fantasy points
        b.rating - a.rating // If tie, sort by rating
    );

    // 🔹 Ensure balanced best 11 players
    let selectedPlayers = [];
    let ratingBuckets = {
      "10": [],
      "9": [],
      "8": [],
      "7": [],
      "6": [],
      "5": [],
      "4": [],
      "3": [],
      "2": [],
      "1": [],
      "0": [],
    };

    // Distribute players into rating buckets
    sortedPlayerStats.forEach((player) => {
      ratingBuckets[player.rating.toFixed(0)].push(player);
    });

    // Pick best players while maintaining diversity in ratings
    for (let i = 10; i >= 0; i--) {
      while (selectedPlayers.length < 11 && ratingBuckets[i].length > 0) {
        selectedPlayers.push(ratingBuckets[i].shift());
      }
    }

    res.json({ match_id, internal_match_id, best_11_players: selectedPlayers });
  } catch (error) {
    console.error("❌ Error fetching best 11 players:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});



app.get("/api/match/:match_id/best-11-players", async (req, res) => {
  try {
    const { match_id } = req.params; // This is the API match ID

    // 🔹 Get Internal Match ID
    const matchQuery = `SELECT id FROM matches WHERE api_id = ?`;
    const [matchData] = await db.execute(matchQuery, [match_id]);

    if (matchData.length === 0) {
      return res.status(404).json({ message: "Match not found" });
    }
    const internal_match_id = matchData[0].id;

    // 🔹 Fetch Match Squads
    const squadQuery = `
      SELECT ms.team_id, p.id AS player_id, p.first_name, 
             p.short_name, p.playing_role, t.name AS team_name
      FROM match_squads ms
      JOIN players p ON ms.player_id = p.id
      JOIN teams t ON ms.team_id = t.id
      WHERE ms.match_id = ?
    `;
    const [squadData] = await db.execute(squadQuery, [internal_match_id]);

    if (squadData.length === 0) {
      return res.status(404).json({ message: "No players found in squads" });
    }

    // 🔹 Fetch Last 5 Matches & Calculate Fantasy Points for Each Player
    const playerStatsPromises = squadData.map(async (player) => {
      const lastMatchesQuery = `
        SELECT match_id, point AS total_fantasy_points, rating 
        FROM match_fantasy_points 
        WHERE player_id = ? 
        ORDER BY match_id DESC 
        LIMIT 5
      `;
      const [lastMatches] = await db.execute(lastMatchesQuery, [player.player_id]);

      if (lastMatches.length === 0) return null;

      // Calculate total & average fantasy points
      const totalPoints = lastMatches.reduce((sum, match) => sum + (match.total_fantasy_points || 0), 0);
      const avgFantasyPoints = (totalPoints / lastMatches.length).toFixed(2);
      const avgRating = (lastMatches.reduce((sum, match) => sum + (match.rating || 0), 0) / lastMatches.length).toFixed(1);

      return {
        player_id: player.player_id,
        player_name: player.first_name, 
        short_name: player.short_name,
        playing_role: player.playing_role,
        team_name: player.team_name,
        total_fantasy_points: totalPoints,
        avg_fantasy_points: avgFantasyPoints,
        rating: Math.min(avgRating, 10) 
      };
    });

    const playerStats = (await Promise.all(playerStatsPromises)).filter((p) => p !== null);

    // 🔹 Sort Players by Performance (Fantasy Points & Rating)
    const sortedPlayerStats = playerStats.sort(
      (a, b) =>
        b.avg_fantasy_points - a.avg_fantasy_points ||
        b.rating - a.rating
    );

    // 🔹 Ensure Balanced Selection of Best 11 Players
    let selectedPlayers = [];
    let roleBuckets = { bat: [], bowl: [], all: [], wk: [] };

    sortedPlayerStats.forEach((player) => {
      if (roleBuckets[player.playing_role]) {
        roleBuckets[player.playing_role].push(player);
      }
    });

    selectedPlayers.push(...roleBuckets.wk.slice(0, 1));
    selectedPlayers.push(...roleBuckets.bat.slice(0, 3));
    selectedPlayers.push(...roleBuckets.all.slice(0, 2));
    selectedPlayers.push(...roleBuckets.bowl.slice(0, 3));

    const remainingPlayers = sortedPlayerStats.filter((p) => !selectedPlayers.includes(p));
    while (selectedPlayers.length < 11 && remainingPlayers.length) {
      selectedPlayers.push(remainingPlayers.shift());
    }

    res.json({ match_id, internal_match_id, best_11_players: selectedPlayers.slice(0, 11) });
  } catch (error) {
    console.error("❌ Error fetching best 11 players:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});



















// ------------------------------crciket addictor apis -------------------------------


app.get("/team-comparison-new", async (req, res) => {
  try {
    const { teamA, teamB } = req.query;

    if (!teamA || !teamB) {
      return res
        .status(400)
        .json({ message: "Both teamA and teamB parameters are required" });
    }

    const query = `
      WITH last_matches_A AS (
          SELECT 
              m.id AS match_id,
              m.api_id AS api_id,
              ? AS team_id, 
              CASE 
                  WHEN m.team_1 = ? THEN m.team_2 
                  ELSE m.team_1 
              END AS opponent_id, 
              m.winning_team_id
          FROM matches m
          WHERE (m.team_1 = ? OR m.team_2 = ?)  
            AND m.match_status_id = 2
          ORDER BY m.date_start DESC
          LIMIT 5
      ),
      last_matches_B AS (
          SELECT 
              m.id AS match_id,
              m.api_id AS api_id,
              ? AS team_id, 
              CASE 
                  WHEN m.team_1 = ? THEN m.team_2 
                  ELSE m.team_1 
              END AS opponent_id, 
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
          COUNT(lm.match_id) AS total_matches,
          SUM(CASE WHEN lm.team_id = lm.winning_team_id THEN 1 ELSE 0 END) AS wins,
          ROUND((SUM(CASE WHEN lm.team_id = lm.winning_team_id THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(lm.match_id), 0))) AS win_percentage,
          GROUP_CONCAT(
              CONCAT(
                  lm.api_id, ':', 
                  CASE 
                      WHEN lm.winning_team_id = lm.team_id THEN 'W' 
                      WHEN lm.winning_team_id IS NULL THEN 'D' 
                      ELSE 'L' 
                  END
              ) 
              ORDER BY lm.match_id DESC SEPARATOR ', '
          ) AS recent_form_with_api_ids,
          GROUP_CONCAT(
              CONCAT(
                  lm.match_id, ':', 
                  CASE 
                      WHEN lm.winning_team_id = lm.team_id THEN 'W' 
                      WHEN lm.winning_team_id IS NULL THEN 'D' 
                      ELSE 'L' 
                  END
              ) 
              ORDER BY lm.match_id DESC SEPARATOR ', '
          ) AS recent_form_with_match_ids,
          GROUP_CONCAT(
              CASE 
                  WHEN lm.winning_team_id = lm.team_id THEN 'W' 
                  WHEN lm.winning_team_id IS NULL THEN 'D' 
                  ELSE 'L' 
              END 
              ORDER BY lm.match_id DESC SEPARATOR ', '
          ) AS recent_form_simple
      FROM (
          SELECT * FROM last_matches_A
          UNION ALL
          SELECT * FROM last_matches_B
      ) AS lm 
      JOIN teams t ON lm.team_id = t.id
      WHERE lm.team_id IN (?, ?)  
      GROUP BY t.id, t.name;
    `;

    const [results] = await db.execute(query, [
      teamA, teamA, teamA, teamA,
      teamB, teamB, teamB, teamB,
      teamA, teamB
    ]);

    res.json(results);
  } catch (error) {
    console.error("❌ Error fetching team comparison data:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});


app.get("/venue-pitch-report-new", async (req, res) => {
  try {
    const { match_id } = req.query;

    if (!match_id) {
      return res.status(400).json({ error: "match_id (api_id) is required." });
    }

    // ✅ Step 1: Get Venue ID from Match ID
    const matchQuery = `SELECT id, api_id, venue_id FROM matches WHERE api_id = ? LIMIT 1;`;
    const [matchResult] = await db.execute(matchQuery, [match_id]);

    if (!matchResult.length || !matchResult[0].venue_id) {
      return res.status(404).json({ error: "Match not found or Venue ID is missing." });
    }

    const venue_id = matchResult[0].venue_id;

    // ✅ Step 2: Fetch the Last 5 Completed Matches at this Venue
    const lastMatchesQuery = `
      SELECT m.id AS match_id, m.api_id, m.date_start, m.team_1, m.team_2, m.winning_team_id
      FROM matches m
      WHERE m.venue_id = ? 
      AND m.match_status_id = 2  
      ORDER BY m.date_start DESC  
      LIMIT 5;
    `;
    const [lastMatches] = await db.execute(lastMatchesQuery, [venue_id]);

    if (!lastMatches.length) {
      return res.status(404).json({ error: "No last 5 completed matches found at this venue." });
    }

    const matchIds = lastMatches.map((m) => m.match_id);
    
    if (matchIds.length === 0) {
      return res.status(404).json({ error: "No valid match IDs found for this venue." });
    }

    // ✅ Step 3: Fetch First-Inning Averages & Highest Successful Chase
    const placeholders = matchIds.map(() => "?").join(",");
    const query = `
      WITH first_innings_scores AS (
          SELECT match_id, SUM(score_runs) AS total_score
          FROM match_innings
          WHERE match_id IN (${placeholders}) 
          AND number = 1  
          GROUP BY match_id
      ),

      second_innings_scores AS (
          SELECT mi.match_id, m.winning_team_id, SUM(mi.score_runs) AS total_score
          FROM match_innings mi
          JOIN matches m ON mi.match_id = m.id
          WHERE mi.match_id IN (${placeholders}) 
          AND mi.number = 2  
          AND m.winning_team_id IS NOT NULL  -- ✅ Ensures only successful chases are considered
          GROUP BY mi.match_id, m.winning_team_id
      )

      SELECT 
          v.id AS venue_id,
          v.name AS venue_name,
          COALESCE(ROUND(SUM(fis.total_score) / NULLIF(COUNT(fis.match_id), 0), 0), 0) AS avg_first_inning_score,

          (SELECT 
              COALESCE(MAX(sis.total_score), 0)
          FROM second_innings_scores sis
      ) AS highest_successful_chase

      FROM venues v
      LEFT JOIN first_innings_scores fis ON 1=1
      WHERE v.id = ?;
    `;

    const params = [...matchIds, ...matchIds, venue_id];
    const [rows] = await db.execute(query, params);

    if (!rows.length) {
      return res.status(404).json({ error: "No data available for these matches." });
    }

    const response = {
      venue_id: rows[0].venue_id,
      venue_name: rows[0].venue_name,
      avg_first_inning_score: rows[0].avg_first_inning_score,
      highest_successful_chase: rows[0].highest_successful_chase,
      last_5_matches: lastMatches.map((match) => ({
        match_id: match.match_id,
        api_id: match.api_id,
        date_start: match.date_start,
        team_1: match.team_1,
        team_2: match.team_2
      }))
    };

    res.json(response);

  } catch (error) {
    console.error("❌ Error fetching venue pitch report:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});





app.get("/team-comparison-venue-new", async (req, res) => {
  try {
    const { teamA, teamB, match_id } = req.query;

    if (!teamA || !teamB || !match_id) {
      return res
        .status(400)
        .json({ message: "teamA, teamB, and match_id parameters are required" });
    }

    // ✅ Step 1: Get Venue ID & Venue Name from Match ID
    const venueQuery = `
      SELECT v.id AS venue_id, v.name AS venue_name 
      FROM matches m
      JOIN venues v ON m.venue_id = v.id
      WHERE m.id = ? 
      LIMIT 1;
    `;

    const [venueResult] = await db.execute(venueQuery, [match_id]);

    if (!venueResult.length) {
      return res.status(404).json({ error: "Match not found or Venue ID is missing." });
    }

    const { venue_id, venue_name } = venueResult[0];

    // ✅ Step 2: Fetch the Last 5 Completed Matches at This Venue Involving Either Team
    const lastMatchesQuery = `
      SELECT 
          m.id AS match_id, 
          m.api_id, 
          m.date_start, 
          m.winning_team_id, 
          m.win_margin,
          t1.name AS team_1_name,
          t2.name AS team_2_name,
          winner_team.name AS winning_team_name
      FROM matches m
      JOIN teams t1 ON m.team_1 = t1.id
      JOIN teams t2 ON m.team_2 = t2.id
      LEFT JOIN teams winner_team ON m.winning_team_id = winner_team.id
      WHERE m.venue_id = ? 
        AND m.match_status_id = 2 
        AND (m.team_1 = ? OR m.team_2 = ? OR m.team_1 = ? OR m.team_2 = ?)
      ORDER BY m.date_start DESC  
      LIMIT 5;
    `;

    const [lastMatches] = await db.execute(lastMatchesQuery, [venue_id, teamA, teamA, teamB, teamB]);

    if (!lastMatches.length) {
      return res.status(404).json({ error: "No last 5 completed matches found at this venue for the given teams." });
    }

    // ✅ Step 3: Calculate Toss Impact (Matches Won Batting First)
    const tossImpactQuery = `
      SELECT COUNT(*) AS total_matches,
             SUM(CASE WHEN m.winning_team_id = m.team_1 THEN 1 ELSE 0 END) AS batting_first_wins
      FROM matches m
      WHERE m.venue_id = ? 
        AND m.match_status_id = 2;
    `;

    const [tossImpactResult] = await db.execute(tossImpactQuery, [venue_id]);
    const totalMatches = tossImpactResult[0].total_matches || 0;
    const battingFirstWins = tossImpactResult[0].batting_first_wins || 0;
    const tossImpactPercentage = totalMatches > 0 ? ((battingFirstWins / totalMatches) * 100).toFixed(2) : "N/A";

    // ✅ Step 4: Format Match Outcomes & Winning Patterns (With Team Names)
    const lastFiveResults = lastMatches.map((match) => {
      return {
        match_id: match.match_id,
        api_id: match.api_id,
        date_start: match.date_start,
        team_1: match.team_1_name,
        team_2: match.team_2_name,
        winning_team: match.winning_team_name || "No Result",
        win_margin: match.win_margin
      };
    });

    const response = {
      venue: {
        venue_id: venue_id,
        venue_name: venue_name
      },
      toss_impact: `${tossImpactPercentage}% matches won batting first`,
      last_5_results: lastFiveResults
    };

    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching team comparison at venue:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});



app.get("/head-to-head-record-new", async (req, res) => {
  try {
    const { teamA, teamB } = req.query;

    if (!teamA || !teamB) {
      return res
        .status(400)
        .json({ message: "Both teamA and teamB parameters are required" });
    }

    // ✅ Step 1: Fetch Last 5 Matches Between Team A and Team B
    const lastMatchesQuery = `
      SELECT 
          m.id AS match_id, 
          m.api_id, 
          DATE_FORMAT(m.date_start, '%Y-%m-%d') AS match_date, 
          m.winning_team_id, 
          m.win_margin,
          t1.name AS team_1_name,
          t2.name AS team_2_name,
          wt.name AS winning_team_name
      FROM matches m
      JOIN teams t1 ON m.team_1 = t1.id
      JOIN teams t2 ON m.team_2 = t2.id
      LEFT JOIN teams wt ON m.winning_team_id = wt.id
      WHERE (m.team_1 = ? AND m.team_2 = ?) OR (m.team_1 = ? AND m.team_2 = ?)
        AND m.match_status_id = 2
      ORDER BY m.date_start DESC  
      LIMIT 5;
    `;

    const [lastMatches] = await db.execute(lastMatchesQuery, [teamA, teamB, teamB, teamA]);

    // ✅ Step 2: Fetch Historical Stats
    const historicalStatsQuery = `
      SELECT 
          COUNT(*) AS total_matches,
          SUM(CASE WHEN m.winning_team_id = ? THEN 1 ELSE 0 END) AS teamA_wins,
          SUM(CASE WHEN m.winning_team_id = ? THEN 1 ELSE 0 END) AS teamB_wins,
          SUM(CASE WHEN m.winning_team_id IS NULL THEN 1 ELSE 0 END) AS ties
      FROM matches m
      WHERE (m.team_1 = ? AND m.team_2 = ?) OR (m.team_1 = ? AND m.team_2 = ?)
    `;

    const [historicalStats] = await db.execute(historicalStatsQuery, [teamA, teamB, teamA, teamB, teamB, teamA]);

    // ✅ Step 3: Fetch Notable Records (Only for Team A & Team B)
    const notableRecordsQuery = `
      SELECT 
        (SELECT CONCAT(t.name, ' (', mi.score_runs, '/', mi.max_over, ')') 
         FROM match_innings mi
         JOIN teams t ON mi.batting_team_id = t.id
         JOIN matches m ON mi.match_id = m.id
         WHERE (m.team_1 IN (?, ?) OR m.team_2 IN (?, ?))
         AND mi.score_runs IS NOT NULL
         ORDER BY mi.score_runs DESC LIMIT 1) AS highest_team_score,

        (SELECT CONCAT(p.first_name, ' ', p.last_name, ' (', mib.wickets, '/', mib.runs_conceded, ')') 
         FROM match_inning_bowlers mib
         JOIN players p ON mib.bowler_id = p.id
         JOIN match_innings mi ON mib.match_inning_id = mi.id
         JOIN matches m ON mi.match_id = m.id
         WHERE (m.team_1 IN (?, ?) OR m.team_2 IN (?, ?))
         AND mib.wickets > 0
         ORDER BY mib.wickets DESC, mib.runs_conceded ASC LIMIT 1) AS best_bowling,

        (SELECT CONCAT(p.first_name, ' ', p.last_name, ' (', mibat.runs, '*') 
         FROM match_inning_batters mibat
         JOIN players p ON mibat.batsman_id = p.id
         JOIN match_innings mi ON mibat.match_inning_id = mi.id
         JOIN matches m ON mi.match_id = m.id
         WHERE (m.team_1 IN (?, ?) OR m.team_2 IN (?, ?))
         AND mibat.runs > 0
         ORDER BY mibat.runs DESC LIMIT 1) AS highest_individual_score;
    `;

    const [notableRecords] = await db.execute(notableRecordsQuery, [teamA, teamB, teamA, teamB, teamA, teamB, teamA, teamB, teamA, teamB, teamA, teamB]);

    // ✅ Step 4: Format Response Data
    const lastFiveResults = lastMatches.map((match) => ({
      match_date: match.match_date,
      match_result: `${match.team_1_name} vs ${match.team_2_name} - ${match.winning_team_name || "No Result"} won by ${match.win_margin}`,
      winning_team: match.winning_team_name
    }));

    const response = {
      head_to_head_records: {
        last_5_encounters: lastFiveResults
      },
      historical_stats: {
        total_matches: historicalStats[0].total_matches,
        teamA_wins: historicalStats[0].teamA_wins,
        teamB_wins: historicalStats[0].teamB_wins,
        no_result_or_tied: historicalStats[0].ties
      },
      notable_records: {
        highest_team_score: notableRecords[0].highest_team_score || "Not available",
        // best_bowling: notableRecords[0].best_bowling || "Not available",
        // highest_individual_score: notableRecords[0].highest_individual_score || "Not available"
      }
    };

    res.json(response);
  } catch (error) {
    console.error("❌ Error fetching head-to-head records:", error.message);
    res.status(500).json({ message: "Server error" });
  }
});







import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { OpenAI } from 'openai';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Helper to parse resume text
function parseResume(resumeText: string) {
  const lines = resumeText.split('\n');
  const info: string[] = [];
  let bodyStart = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].trim()) info.push(lines[idx].trim());
    if (info.length === 6) {
      bodyStart = idx + 1;
      break;
    }
  }
  const [headline, name, email, phone, location, linkedin] = info;
  while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;
  const body = lines.slice(bodyStart).join('\n');
  return { headline, name, email, phone, location, linkedin, body };
}

// Helper to build OpenAI prompt
function buildPrompt(baseResume: string, jobDescription: string) {
  return `
You are a world-class technical resume assistant.

SYSTEM INSTRUCTION: Make the resume align as closely as possible with the Job Description (JD). Must proactively REPLACE, REPHRASE, and ADD bullet points under each Experience entry, especially recent/current roles, to ensure the language, skills, and technologies match the JD specifically. Do NOT leave any Experience section or bullet point unchanged if it could better reflect or incorporate keywords, duties, or requirements from the JD. Acceptable and encouraged to write NEW bullet points where there are relevant experiences (even if not previously mentioned). Prioritize jobs/roles closest to the desired job.

Your main objectives:
1. Maximize keyword/skills and responsibilities match between the resume and the job description (JD). Use the exact relevant technology, tool, process, or methodology names from the JD wherever accurate.
2. Preserve all original company names, job titles, and periods/dates in the Professional Experience section.
3. In each Experience/job entry, ensure 6–8 highly relevant and impactful bullet points. Aggressively update, rewrite, or add new ones so they reflect the actual duties, skills, or stacks requested in the JD—especially prioritizing skills, tools, or requirements from the current and most recent positions. If an original bullet or responsibility does not closely match the JD, replace or revise it.
4. Make the experiences emphasize the main tech stack from the JD in the most recent or relevant roles, and distribute additional or secondary JD requirements across earlier positions naturally. Each company’s experience should collectively cover the full range of JD skills and duties.
5. Place the SKILLS section immediately after the SUMMARY section and before the PROFESSIONAL EXPERIENCE section. This ensures all key stacks and technologies are visible at the top of the resume for ATS and recruiters.
6. In the Summary, integrate the most essential and high-priority skills, stacks, and requirements from the JD, emphasizing the strongest elements from the original. Keep it dense with relevant keywords and technologies, but natural in tone.
7. In every section (Summary, Skills, Experience), INCLUDE as many relevant unique keywords and technologies from the job description as possible.
8. CRITICAL SKILLS SECTION: Create an EXCEPTIONALLY RICH, DENSE, and COMPREHENSIVE Skills section. Extract and list EVERY technology, tool, framework, library, service, and methodology from BOTH the JD AND candidate's experience. Make it so comprehensive it dominates keyword matching.
MANDATORY STRUCTURE (IN THIS EXACT FORMAT):
Frontend
Backend
Databases
Cloud & DevOps
Testing & Automation
AI/Automation Tools (if relevant)
Other Tools

Each category must have 12–20+ comma-separated skills, prioritizing JD keywords first. Follow the sample formatting and grouping rules as defined earlier.
9. Preserve all original quantified metrics (numbers, percentages, etc.) and actively introduce additional quantification in new or reworded bullets wherever possible. Use measurable outcomes, frequency, scope, or scale to increase the impact of each responsibility or accomplishment. Strive for at least 75% of all Experience bullet points to include a number, percentage, range, or scale to strengthen ATS, recruiter, and hiring manager perception.
10. Strictly maximize verb variety: No action verb (e.g., developed, led, built, designed, implemented, improved, created, managed, engineered, delivered, optimized, automated, collaborated, mentored) may appear more than twice in the entire document, and never in adjacent or back-to-back bullet points within or across jobs. Each bullet must start with a unique, action-oriented verb whenever possible.
11. In all Experience bullets, prefer keywords and phrasing directly from the JD where it truthfully reflects the candidate's background and would boost ATS/recruiter relevance.
12. Distribute JD-aligned technologies logically across roles.
- Assign primary/core technologies from the JD to the most recent or relevant positions.
- Assign secondary or supporting technologies to earlier roles.
- Ensure all key JD technologies appear at least once across the resume.

13. Ensure natural tone and realism. Only include technologies or responsibilities that the candidate could reasonably have used, based on their career path or industry.
14. The final resume should read as cohesive, naturally written, and contextually plausible—not artificially optimized.
15. Maintain all original section headers and formatting. Do not include commentary or extra text outside the resume.
Here is the base resume:
16. Include explicit database-related experience in the Professional Experience section.
17. Set the number of experiences in each company as 7-9.
${baseResume}

Here is the target job description:

${jobDescription}

Output the improved resume as plain text, exactly following the original resume's format—including the unchanged headline at the top. Clearly label sections (Summary, Professional Experience, Skills, Education, etc) with original spacing, section order, and no decorative lines or symbols.
  `;
}

// Helper to convert date format from MM/YYYY to MMM YYYY
function formatDate(dateStr: string): string {
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  // Handle different date formats
  if (dateStr.includes('–') || dateStr.includes('-')) {
    // Split by dash and format each part
    const parts = dateStr.split(/[–-]/).map(part => part.trim());
    return parts.map(part => {
      if (part.match(/^\d{2}\/\d{4}$/)) {
        const [month, year] = part.split('/');
        const monthIndex = parseInt(month) - 1;
        return `${monthNames[monthIndex]} ${year}`;
      }
      return part; // Return as-is if not in MM/YYYY format
    }).join(' – ');
  } else if (dateStr.match(/^\d{2}\/\d{4}$/)) {
    // Single date in MM/YYYY format
    const [month, year] = dateStr.split('/');
    const monthIndex = parseInt(month) - 1;
    return `${monthNames[monthIndex]} ${year}`;
  }

  return dateStr; // Return as-is if not in expected format
}

// Helper to wrap text within a max width
function wrapText(text: string, font: any, size: number, maxWidth: number) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (let i = 0; i < words.length; i++) {
    const testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
    const testWidth = font.widthOfTextAtSize(testLine, size);
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// Helper to draw text with bold segments (markdown **bold**)
function drawTextWithBold(
  page: any,
  text: string,
  x: number,
  y: number,
  font: any,
  fontBold: any,
  size: number,
  color: any
) {
  // Split by ** for bold
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  let offsetX = x;
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      const content = part.slice(2, -2);
      page.drawText(content, { x: offsetX, y, size, font: fontBold, color });
      offsetX += fontBold.widthOfTextAtSize(content, size);
    } else {
      page.drawText(part, { x: offsetX, y, size, font, color });
      offsetX += font.widthOfTextAtSize(part, size);
    }
  }
}

// PDF generation function
async function generateResumePdf(resumeText: string): Promise<Uint8Array> {
  const { name, email, phone, location, linkedin, body } = parseResume(resumeText);

  console.log('resumeText', resumeText);
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Color scheme for better visual hierarchy
  const BLACK = rgb(0, 0, 0);
  const DARK_BLUE = rgb(0.1, 0.2, 0.4); // For section headers
  const MEDIUM_BLUE = rgb(0.2, 0.4, 0.6); // For job titles
  const GRAY = rgb(0.4, 0.4, 0.4); // For company names and periods
  const DARK_GRAY = rgb(0.2, 0.2, 0.2); // For contact info

  const MARGIN_TOP = 72; // 1 inch = 72 points
  const MARGIN_BOTTOM = 50;
  const MARGIN_LEFT = 50;
  const MARGIN_RIGHT = 50;
  const PAGE_WIDTH = 595;
  const PAGE_HEIGHT = 842;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

  // ATS-friendly font sizes
  const NAME_SIZE = 24; // Increased from 20 to 24 for better prominence
  const CONTACT_SIZE = 9; // Reduced from 10 to 9 (1px smaller)
  const SECTION_HEADER_SIZE = 14; // Increased from 12 to 14 for better visibility
  const BODY_SIZE = 11; // 10-12pt for body text

  // ATS-friendly line spacing (1.15 - 1.5 line height)
  const NAME_LINE_HEIGHT = NAME_SIZE * 0.8;
  const CONTACT_LINE_HEIGHT = CONTACT_SIZE * 1.5;
  const SECTION_LINE_HEIGHT = SECTION_HEADER_SIZE * 1.5;
  const BODY_LINE_HEIGHT = BODY_SIZE * 1.4;

  let y = PAGE_HEIGHT - MARGIN_TOP;
  const left = MARGIN_LEFT;
  const right = PAGE_WIDTH - MARGIN_RIGHT;

  // Name (large, bold, dark blue) - uppercase for emphasis
  if (name) {
    const nameLines = wrapText(name.toUpperCase(), fontBold, NAME_SIZE, CONTENT_WIDTH);
    for (const line of nameLines) {
      page.drawText(line, { x: left, y, size: NAME_SIZE, font: fontBold, color: DARK_BLUE });
      y -= NAME_LINE_HEIGHT;
    }
    y -= 2; // Small gap after name
  } else {
    y -= NAME_LINE_HEIGHT;
  }

  // Contact info on single line with bullet separators (like the image)
  const contactParts = [
    location,
    phone,
    email,
    linkedin
  ].filter(Boolean);

  if (contactParts.length > 0) {
    const contactLine = contactParts.join(' • ');
    const contactLines = wrapText(contactLine, font, CONTACT_SIZE, CONTENT_WIDTH);
    for (const line of contactLines) {
      page.drawText(line, { x: left, y, size: CONTACT_SIZE, font, color: DARK_GRAY });
      y -= CONTACT_LINE_HEIGHT;
    }
    y -= 4; // Small gap before horizontal line
  }

  // Draw horizontal line under contact info (like the image)
  page.drawLine({
    start: { x: left, y: y },
    end: { x: right, y: y },
    thickness: 1.5,
    color: DARK_BLUE
  });
  y -= 16; // Gap after horizontal line

  // Body (sections, skills, etc., wrapped)
  const bodyLines = body.split('\n');
  let inSkillsSection = false;
  const skills: string[] = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i].trim();
    if (!line) {
      y -= 6; // Reduced gap between paragraphs for ATS
      continue;
    }
    if (line.endsWith(':')) {
      y -= 12; // Increased gap before section header for better separation
      const sectionLines = wrapText(line, fontBold, SECTION_HEADER_SIZE, CONTENT_WIDTH);
      for (const sectionLine of sectionLines) {
        page.drawText(sectionLine, { x: left, y, size: SECTION_HEADER_SIZE, font: fontBold, color: DARK_BLUE });
        y -= SECTION_LINE_HEIGHT;
        if (y < MARGIN_BOTTOM) {
          page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          y = PAGE_HEIGHT - MARGIN_TOP;
        }
      }
      // Detect start of Skills section
      if (line.toLowerCase() === 'skills:') {
        inSkillsSection = true;
      }
    } else {
      // Check if this is a job experience line (Role at Company: Period)
      const isJobExperience = / at .+:.+/.test(line);

      if (isJobExperience) {
        // Parse job experience: Role at Company: Period
        const match = line.match(/^(.+?) at (.+?):\s*(.+)$/);
        if (match) {
          const [, jobTitle, companyName, period] = match;

          y -= 8; // Extra gap before job entry

          // Job Title (bold, blue)
          const titleLines = wrapText(jobTitle.trim(), fontBold, BODY_SIZE + 1, CONTENT_WIDTH - 10);
          for (const titleLine of titleLines) {
            page.drawText(titleLine, { x: left + 10, y, size: BODY_SIZE + 1, font: fontBold, color: MEDIUM_BLUE });
            y -= BODY_LINE_HEIGHT + 2;
            if (y < MARGIN_BOTTOM) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN_TOP;
            }
          }

          // Company Name (italic, gray)
          const companyLines = wrapText(companyName.trim(), font, BODY_SIZE, CONTENT_WIDTH - 10);
          for (const companyLine of companyLines) {
            page.drawText(companyLine, { x: left + 10, y, size: BODY_SIZE, font, color: GRAY });
            y -= BODY_LINE_HEIGHT;
            if (y < MARGIN_BOTTOM) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN_TOP;
            }
          }

          // Period (formatted and styled)
          const formattedPeriod = formatDate(period.trim());
          const periodLines = wrapText(formattedPeriod, font, BODY_SIZE - 1, CONTENT_WIDTH - 10);
          for (const periodLine of periodLines) {
            page.drawText(periodLine, { x: left + 10, y, size: BODY_SIZE - 1, font, color: GRAY });
            y -= BODY_LINE_HEIGHT - 2;
            if (y < MARGIN_BOTTOM) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN_TOP;
            }
          }

          y -= 4; // Gap before experience bullets
        }
      } else {
        // Check if this is a skills category line (starts with ·)
        const isSkillsCategory = line.startsWith('·');

        if (isSkillsCategory) {
          // Skills category header (bold, dark blue)
          const categoryName = line.trim(); // Remove the · symbol
          const categoryLines = wrapText(categoryName, fontBold, BODY_SIZE + 1, CONTENT_WIDTH - 20);
          for (const categoryLine of categoryLines) {
            page.drawText(categoryLine, { x: left + 10, y, size: BODY_SIZE + 1, font: fontBold, color: MEDIUM_BLUE });
            y -= BODY_LINE_HEIGHT + 2;
            if (y < MARGIN_BOTTOM) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN_TOP;
            }
          }
        } else {
          // Regular body text with proper indentation and line height
          const wrappedLines = wrapText(line, font, BODY_SIZE, CONTENT_WIDTH - 10); // indent body
          for (const wrappedLine of wrappedLines) {
            drawTextWithBold(page, wrappedLine, left + 10, y, font, fontBold, BODY_SIZE, BLACK);
            y -= BODY_LINE_HEIGHT;
            if (y < MARGIN_BOTTOM) {
              page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
              y = PAGE_HEIGHT - MARGIN_TOP;
            }
          }
        }
      }
    }
    if (y < MARGIN_BOTTOM) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN_TOP;
    }
  }
  // If the document ends while still in the skills section, render the skills
  if (inSkillsSection && skills.length > 0) {
    // Render comma-separated skills as wrapped text with better styling
    const skillsText = skills.join(' ');
    const wrappedSkillLines = wrapText(skillsText, font, BODY_SIZE, CONTENT_WIDTH - 20);
    for (const skillLine of wrappedSkillLines) {
      page.drawText(skillLine, { x: left + 20, y, size: BODY_SIZE, font, color: DARK_GRAY });
      y -= BODY_LINE_HEIGHT;
      if (y < MARGIN_BOTTOM) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN_TOP;
      }
    }
  }

  return await pdfDoc.save();
}

export async function POST(req: NextRequest) {
  try {
    // 1. Parse form data
    const formData = await req.formData();
    const jobDescription = formData.get('job_description') as string;
    const company = formData.get('company') as string;
    const role = formData.get('role') as string;

    // Validate required fields
    if (!jobDescription || !company || !role) {
      return new NextResponse(
        JSON.stringify({ error: 'Missing required fields: job_description, company, role' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return new NextResponse(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Load base resume from app directory (Vercel compatible)
    let baseResume: string = `
Senior Software Engineer

Louis Bailey
Senior Software Engineer
luoisbailey21412@gmail.com
+1 (430) 964 0645
San Antonio, TX, USA

Summary:

Senior Software Engineer with over 10 years of experience delivering scalable, high-performance SaaS platforms and web/mobile applications 
across diverse domains including finance, retail, and education. Proven expertise in cloud-native architectures, microservices, and full-stack development 
using technologies like C#, ASP.NET Core, React.js, Node.js, Python, Docker, and Kubernetes. Skilled in driving large-scale cloud migrations, real-time systems, and secure API 
integrations that serve multi-tenant environments and global user bases. Known for leading cross-functional teams and delivering mission-critical solutions 
with high availability and performance. Passionate about DevOps, automation (CI/CD), and building robust platforms that improve operational efficiency, developer productivity, and customer experience.


Professional Experience:

Senior Software Engineer at Softcom: 06/2022 - Current
•	Led the platform-wide modernization effort by decomposing a tightly coupled legacy application into independent microservices using ASP.NET Core, containerized with Docker, and orchestrated via Kubernetes. Migrating workloads to AWS (ECS, RDS, S3, CloudWatch) reduced infrastructure costs by 25%, improved deployment reliability, and increased system uptime to 99.97%, enabling on-demand scalability and region-specific failover.
•	Designed and implemented RESTful API gateways and internal services using .NET 6, TypeScript, and Node.js, establishing standardized service contracts for internal and external integrations. These APIs supported customer usage metering, billing, authentication, and workflow automations, and were hardened for multitenancy using strict isolation and tenant-aware logic.
•	Developed a centralized customer and user identity management service using Entity Framework Core, PostgreSQL, and Redis for session caching. This system unified authentication across web, mobile, and partner apps, and allowed dynamic permission and role mapping for thousands of enterprise tenants with complex access control models.
•	Built real-time communication and collaboration pipelines using SignalR, Azure Service Bus, and Redis Pub/Sub, enabling rich interactive features like presence detection, live updates, and cross-user notifications within a collaborative workspace UI. These capabilities were instrumental in expanding the platform's value to remote teams and distributed users.
•	Spearheaded the development of an integrated video calling and virtual meeting module using WebRTC, tightly coupled with the calendar, chat, and scheduling systems. Backed by ASP.NET Core APIs and a React Native frontend, the module improved product engagement and reduced churn for enterprise customers offering remote support or virtual consultation services.
•	Collaborated with data science teams to integrate machine learning models for customer behavior prediction and usage insights. We exposed TensorFlow models via RESTful endpoints using ASP.NET Core, and used them to power recommendation engines, usage alerts, and intelligent onboarding workflows — leading to a measurable drop in churn and a 21% increase in feature adoption.
•	Automated billing, usage tracking, and claims processing workflows using Azure Logic Apps, SQL Server, and Entity Framework, connecting seamlessly to third-party CRMs, payment gateways, and finance systems. These automations reduced manual data entry by over 40% and ensured accuracy in invoicing and revenue recognition.
•	Implemented enterprise-grade security architecture using OAuth 2.0, JWT tokens, and RBAC policies, supporting granular permissions, audit trails, and identity federation (via SAML/OIDC). Worked closely with InfoSec to conduct penetration testing, threat modeling, and ensure SOC 2 Type II compliance.
•	Established CI/CD pipelines using Azure DevOps, GitLab, and GitHub Actions, integrating build, test, and deployment stages with Terraform for infrastructure provisioning. Leveraged ELK Stack, Prometheus, and Grafana for real-time monitoring, telemetry, and alerting. These pipelines enabled daily releases with rollback support and significantly reduced production incident recovery times.

Software Engineer at Rover: 03/2020 – 09/2022
•	Spearheaded the migration of Rover’s legacy monolithic architecture to a containerized microservices ecosystem using ASP.NET Core, Docker, and Kubernetes, enhancing scalability and fault tolerance while improving development agility.
•	Designed and developed APIs to support core features such as pet service bookings, sitter onboarding, payment transactions, and secure user authentication. Integrated Stripe for payment processing and enforced secure OAuth 2.0 and JWT protocols to ensure safe and seamless financial transactions across web and mobile applications.
•	Led the development of cross-platform mobile applications using React Native and ASP.NET Core, allowing users to manage bookings, view sitter profiles, and communicate on-the-go. The intuitive mobile experience contributed to a 20% increase in app engagement and user satisfaction across both iOS and Android platforms.
•	Built a real-time pet tracking and notification system using SignalR, Redis, and Google Maps APIs, which allowed pet owners to receive instant updates and live tracking during walks or boarding sessions. This transparency significantly increased user trust and engagement, leading to a measurable boost in customer retention.
•	Collaborated with data scientists to integrate machine learning models that delivered personalized pet sitter recommendations based on historical data, behavior, and preferences. These ML-driven enhancements resulted in improved booking rates and a more tailored user experience, helping Rover match customers with ideal service providers.
•	Introduced automated CI/CD pipelines using Jenkins and GitLab, reducing deployment times by 34% and increasing release stability. This automation ensured quick iteration, consistent quality, and reduced hotfix incidents, while supporting parallel development across multiple microservices.
•	Played a central role in strengthening platform-wide security by implementing role-based access control (RBAC), encrypting sensitive user data, and integrating fine-grained permissions. This ensured compliance with industry standards and greatly reduced the risk of data breaches and unauthorized access, especially during platform scaling and geographic expansion.
•	Developed and integrated internationalization (i18n) support, enabling the platform to support multiple languages and currencies. This effort allowed Rover to enter new global markets and increased international user adoption while maintaining consistent UX across all regions.

Software Developer at Intuit : 01/2018 – 02/2020
•	Built scalable microservices using Node.js, Express, and TypeScript to handle millions of retail transactions, inventory updates, and order workflows, integrating with Stripe, PayPal, and logistics providers for seamless payment and fulfillment.
•	Modernized the e-commerce frontend with React.js, Redux, and TypeScript, improving load times, responsiveness, and accessibility across devices while enhancing user experience for millions of shoppers.
•	Led a large-scale cloud migration to AWS using Docker, Kubernetes, and Terraform, enabling autoscaling, reducing downtime incidents by 30%, and cutting infrastructure costs by transitioning from fixed provisioning to cloud-native elasticity.
•	Optimized MongoDB and PostgreSQL databases by refactoring schemas, implementing sharding strategies, and applying indexing techniques, improving query speeds by 40% for catalogs, customer accounts, and transaction histories.
•	Implemented secure authentication using JWT, OAuth 2.0, and MFA for customers and internal staff, achieving full PCI DSS, GDPR, and CCPA compliance while supporting detailed audit logging.
•	Developed real-time event-driven systems with WebSockets and Redis for live inventory tracking, order notifications, and promotional updates, boosting customer engagement and retention.
•	Automated CI/CD pipelines using Jenkins, GitLab CI, and Docker, reducing average deployment times by 40%, improving rollback reliability, and enabling blue/green deployment strategies for high-traffic retail platforms.
•	Partnered with data science teams to integrate TensorFlow-based ML recommendation engines, delivering personalized product suggestions, upsell and cross-sell opportunities, and enhancing overall shopping experience.

Associate Software Developer at The Home Spot : 02/2017 – 03/2018
•	Developed a real-time inventory management system using ASP.NET Core, Java(Spring) and AngularJS, enabling stock tracking across hundreds of stores. This increased inventory visibility, reduced shortages, and provided employees with timely data to fulfill customer demand more effectively.
•	Spearheaded the migration from a monolithic system to a containerized microservices architecture using Java-based services, Docker and Kubernetes, allowing for improved scalability, faster deployment cycles, and seamless handling of seasonal traffic surges during major retail events.
•	Developed RESTful APIs for mission-critical services including order processing, inventory sync, and customer profile management using Java(Spring Boot) and .NET Core. These integrations enabled faster data flow between frontend and backend systems, resulting in a smoother checkout experience for online shoppers.
•	Implemented secure authentication mechanisms using OAuth 2.0, JWT, and multi-factor authentication (MFA) for both customers and internal staff. These upgrades significantly improved the platform’s security posture, especially around sensitive customer and payment data.
•	Designed and launched a mobile-first frontend using React Native, allowing store associates to manage inventory, access order details, and serve customers via handheld devices. This innovation boosted in-store operational efficiency and streamlined task execution on the sales floor.
•	Migrated core applications to AWS cloud infrastructure using EC2, S3, and RDS, leading to a 21% reduction in infrastructure costs and substantial gains in platform reliability and availability during promotional periods.
•	Automated the CI/CD pipeline using Jenkins and GitLab CI, minimizing manual intervention and reducing release downtime by 32%. This allowed the engineering team to deploy new features and fixes more frequently and reliably.

Web Developer Intern at IBM : 11/2015 – 02/2017
•	Developed and maintained the core HR management platform using React.js for the frontend and Node.js with Express.js for the backend, providing HR managers and employees with a smooth and interactive interface.
•	Built and integrated RESTful APIs to handle employee authentication, payroll management, leave requests, and performance tracking, ensuring a seamless experience for both HR teams and employees.
•	Optimized database schemas in MongoDB and PostgreSQL to efficiently store employee records, training modules, and engagement analytics, enabling fast retrieval and secure data handling for thousands of users.
•	Worked on real-time communication features using WebSockets, allowing managers and employees to engage in live chats, performance reviews, and onboarding sessions.
•	Collaborated with the product and design teams to continually enhance the platform’s UI/UX, introducing personalized dashboards, notifications, and reporting tools for HR administrators.
•	Integrated third-party services like Zoom and Google Workspace for virtual interviews, training sessions, and document management, enabling HR operations without leaving the platform.


Skills:

Node.js (Express, NestJS)
ASP.NET Core (C#)
Python (Flask)
Java (Spring Boot)
C++
React.js 
Angular
TypeScript
Redux
Responsive UI design
React Native
AngularJS
WebSockets
reusable component libraries
Storybook
RESTful APIs
GraphQL (Apollo)
OAuth 2.0
JWT
SignalR
Redis
microservices
concurrency control
AWS (EC2, S3, CloudFront, Lambda)
Azure (App Services, Event Hubs)
Docker
Kubernetes
Helm
Jenkins
GitLab CI/CD
Hadoop
Spark
Azure Synapse
real-time analytics
TensorFlow
AI integration (chatbots, booking optimization)
HIPAA
HL7
FHIR
PCI DSS
GDPR
Azure AD
MSAL
RBAC
data encryption
Jest
Enzyme
JUnit
Postman
Swagger
New Relic
Datadog
Azure Monitor
Prometheus
ELK Stack
Git
Jira
VS Code
PM2
MongoDB
PostgreSQL
MySQL
SQL Server

Education:
Bachelor of Science, Computer Science (10/2011 – 08/2015)
The University of Tokyo | Japan
    `;
    // 3. Tailor resume with OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = buildPrompt(baseResume, jobDescription);

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_VERSION || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant for creating professional resume content.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 4096
    });

    const tailoredResume = completion.choices[0].message.content || '';

    if (!tailoredResume) {
      return new NextResponse(
        JSON.stringify({ error: 'Failed to generate tailored resume content' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Generate PDF
    const pdfBytes = await generateResumePdf(tailoredResume);

    // 5. Return PDF as response
    const fileBase = `Louis_Bailey_${company.replace(/[^a-zA-Z0-9_]/g, '_')}_${role.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileBase}.pdf"`
      }
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
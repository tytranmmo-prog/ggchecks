--
-- PostgreSQL database dump
--

\restrict MpgmLIDbLKzzxkSZpDHHEW46ts6h4137zoFtUz4bgbQmMNIdULxZHxh3JeKp0l4

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: ggchecks
--

CREATE SCHEMA drizzle;


ALTER SCHEMA drizzle OWNER TO ggchecks;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: ggchecks
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


ALTER TABLE drizzle.__drizzle_migrations OWNER TO ggchecks;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: ggchecks
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNER TO ggchecks;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: ggchecks
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: check_results; Type: TABLE; Schema: public; Owner: ggchecks
--

CREATE TABLE public.check_results (
    id bigint NOT NULL,
    service_account_id bigint NOT NULL,
    monthly_credits text DEFAULT ''::text NOT NULL,
    additional_credits text DEFAULT ''::text NOT NULL,
    additional_credits_expiry text DEFAULT ''::text NOT NULL,
    member_activities jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_checked timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    screenshot text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.check_results OWNER TO ggchecks;

--
-- Name: check_results_id_seq; Type: SEQUENCE; Schema: public; Owner: ggchecks
--

CREATE SEQUENCE public.check_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.check_results_id_seq OWNER TO ggchecks;

--
-- Name: check_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ggchecks
--

ALTER SEQUENCE public.check_results_id_seq OWNED BY public.check_results.id;


--
-- Name: service_accounts; Type: TABLE; Schema: public; Owner: ggchecks
--

CREATE TABLE public.service_accounts (
    id bigint NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    totp_secret text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    proxy text
);


ALTER TABLE public.service_accounts OWNER TO ggchecks;

--
-- Name: service_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: ggchecks
--

CREATE SEQUENCE public.service_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.service_accounts_id_seq OWNER TO ggchecks;

--
-- Name: service_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: ggchecks
--

ALTER SEQUENCE public.service_accounts_id_seq OWNED BY public.service_accounts.id;


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: ggchecks
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: check_results id; Type: DEFAULT; Schema: public; Owner: ggchecks
--

ALTER TABLE ONLY public.check_results ALTER COLUMN id SET DEFAULT nextval('public.check_results_id_seq'::regclass);


--
-- Name: service_accounts id; Type: DEFAULT; Schema: public; Owner: ggchecks
--

ALTER TABLE ONLY public.service_accounts ALTER COLUMN id SET DEFAULT nextval('public.service_accounts_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: ggchecks
--

COPY drizzle.__drizzle_migrations (id, hash, created_at) FROM stdin;
\.


--
-- Data for Name: check_results; Type: TABLE DATA; Schema: public; Owner: ggchecks
--

COPY public.check_results (id, service_account_id, monthly_credits, additional_credits, additional_credits_expiry, member_activities, last_checked, status, screenshot, created_at) FROM stdin;
1	1	21,984			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.815875+00
2	2	24,200			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.821728+00
3	3	18,000			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.823115+00
4	4	20			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.824048+00
5	5	22,570			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.82718+00
6	6	25,000			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.828025+00
7	7	21,251			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.828655+00
8	8				[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.82939+00
9	9	13,596			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.830179+00
10	10	23,165			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.830945+00
11	11	20,190			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.831648+00
12	12	22,074			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.833619+00
13	13	24,930			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.834492+00
14	14	24,690			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.835095+00
15	15	15,590			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.835536+00
16	16	20,959			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.835975+00
17	17	23,790			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.83754+00
18	18	20,564			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.839553+00
19	19	23,295			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.840554+00
20	20	50			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.841291+00
21	21	19,665			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.841946+00
22	22	24,354			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.84244+00
23	23	24,970			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.842868+00
24	24	23,960			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.843371+00
25	25	24,740			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.843926+00
26	26	24,430			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.844669+00
27	27	15,730			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.845818+00
28	28	18,821			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.84692+00
29	29	24,529			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.847678+00
30	30	7,380			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.849845+00
31	31				[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.850741+00
32	32	25,000			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.851345+00
33	33	23,650			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.851843+00
34	34	18,465			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.852318+00
35	35	20,220			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.852813+00
36	36	25,000			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.853191+00
37	37	24,510			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.853801+00
38	38	50			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.85424+00
39	39	9,963			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.854632+00
40	40	13,640			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.855386+00
41	41	50			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.856055+00
42	42	24,830			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.856606+00
43	43	18,410			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.857236+00
44	44	25,000			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.857734+00
45	45	23,810			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.858157+00
46	46	22,804			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.858711+00
47	47	25,000			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.859143+00
48	48	24,510			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.859583+00
49	49	24,710			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.860064+00
50	50	24,700			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.860987+00
51	51	16,700			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.861609+00
52	52	21,470			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.862304+00
53	53	22,950			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.863014+00
54	54	50			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.863705+00
55	55	24,590			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.864158+00
56	56				[]	2026-04-02 02:41:57.819103+00	error: Uncaught		2026-04-02 02:09:47.86462+00
57	57	24,760	100	May 1, 2026	[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.866166+00
58	58	50			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.866947+00
59	59	14,840			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.867343+00
60	60	24,230			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.867714+00
61	61	24,854			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.868155+00
62	62	19,705			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.868588+00
63	63	24,590			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.869026+00
64	64	48			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.869408+00
65	65	16,560			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.869806+00
66	66	50			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.870212+00
67	67	25,000			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.870598+00
68	68	21,050			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.870966+00
69	69	13,395			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.871371+00
70	70	23,050			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.871808+00
71	71	24,220			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.872869+00
72	72	20,130			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.873985+00
73	73	10,692			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.874771+00
74	74	8,710			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.875312+00
75	75	25,000			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.875806+00
76	76	20,030			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.876362+00
77	77	24,927			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.876854+00
78	78	21,376			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.877431+00
79	79	24,264			[]	2026-04-02 02:41:57.819103+00	ok		2026-04-02 02:09:47.878049+00
80	2				"[]"	2026-04-02 02:49:11.505+00	error: Login did not complete — still on: https://accounts.google.com/v3/signin/challenge/totp?TL=AIgtPP2Q57NbE7G8p2enejoxIPHPjFrg8hH64jmpiZyV2E9dvfJcUJwLV0Zj4jFW&checkConnection=youtube%3A682&checkedDomains=youtube&cid=2&continue=https%3A%2F%2Fone.google.com%2Fai%2Factivity%3Fpli%3D1%26g1_landing_page%3D0&dsh=S-1220696185%3A1775098121338528&flowEntry=ServiceLogin&flowName=GlifWebSignIn&ifkv=AT1y2_XzDpQ3qw7S6qM_tylW0abvsfp55XmvV9gxzfR9v-Nug1hVTrXSoGWo3Xe-VR1V4rmW8reRvg&pstMsg=1		2026-04-02 02:49:11.553904+00
81	1	21,984			"[{\\"name\\":\\"Thành Đạt Nguyễn\\",\\"credit\\":-2736,\\"checkAt\\":\\"2026-04-02T02:50:08.340Z\\"},{\\"name\\":\\"Việt An Nguyễn Cao\\",\\"credit\\":-280,\\"checkAt\\":\\"2026-04-02T02:50:08.340Z\\"}]"	2026-04-02 02:50:08.34+00	ok		2026-04-02 02:50:08.440676+00
82	2	24,200			"[{\\"name\\":\\"thang chienthangvu\\",\\"credit\\":-800,\\"checkAt\\":\\"2026-04-02T02:52:28.322Z\\"}]"	2026-04-02 02:52:28.322+00	ok		2026-04-02 02:52:28.412833+00
83	4	20			[{"name": "VĂN CHIÊU TRẦN", "credit": -22560, "checkAt": "2026-04-02T03:08:07.941Z"}, {"name": "Rdudhd Hdudggid", "credit": -2380, "checkAt": "2026-04-02T03:08:07.941Z"}, {"name": "Mild", "credit": -40, "checkAt": "2026-04-02T03:08:07.941Z"}]	2026-04-02 03:08:07.941+00	ok		2026-04-02 03:08:08.040689+00
84	1	21,984			[{"name": "Thành Đạt Nguyễn", "email": "tada247dotxyz@gmail.com", "credit": -2736, "checkAt": "2026-04-02T04:01:49.684Z"}, {"name": "Việt An Nguyễn Cao", "email": "ngcaovietan328@gmail.com", "credit": -280, "checkAt": "2026-04-02T04:01:49.684Z"}]	2026-04-02 04:01:49.684+00	ok		2026-04-02 04:01:49.73723+00
85	1	21,984			[{"name": "abdullaiguerrier51@gmail.com", "email": "abdullaiguerrier51@gmail.com", "credit": 0, "checkAt": "2026-04-02T04:06:37.472Z"}, {"name": "Việt An Nguyễn Cao", "email": "ngcaovietan328@gmail.com", "credit": -280, "checkAt": "2026-04-02T04:06:37.472Z"}, {"name": "Nghĩa Trần Văn", "email": "henefisa.work@gmail.com", "credit": 0, "checkAt": "2026-04-02T04:06:37.472Z"}, {"name": "Thành Đạt Nguyễn", "email": "tada247dotxyz@gmail.com", "credit": -2736, "checkAt": "2026-04-02T04:06:37.472Z"}, {"name": "vtrinh086@gmail.com", "email": "vtrinh086@gmail.com", "credit": 0, "checkAt": "2026-04-02T04:06:37.472Z"}]	2026-04-02 04:06:37.472+00	ok		2026-04-02 04:06:37.525673+00
86	2	24,200			[{"name": "abolirowe733317@gmail.com", "email": "abolirowe733317@gmail.com", "credit": 0, "checkAt": "2026-04-02T04:17:32.432Z"}, {"name": "thang chienthangvu", "email": "thangvu030198@gmail.com", "credit": -800, "checkAt": "2026-04-02T04:17:32.432Z"}, {"name": "Winter Sky", "email": "baserker2010@gmail.com", "credit": 0, "checkAt": "2026-04-02T04:17:32.432Z"}, {"name": "Dũ Trần", "email": "duu.trancong@gmail.com", "credit": 0, "checkAt": "2026-04-02T04:17:32.432Z"}, {"name": "NXC Japan", "email": "xuancongjapan@gmail.com", "credit": 0, "checkAt": "2026-04-02T04:17:32.432Z"}]	2026-04-02 04:17:32.432+00	ok		2026-04-02 04:17:32.487311+00
\.


--
-- Data for Name: service_accounts; Type: TABLE DATA; Schema: public; Owner: ggchecks
--

COPY public.service_accounts (id, email, password, totp_secret, notes, created_at, updated_at, proxy) FROM stdin;
3	AlbertLanehart8@gmail.com	prj9dqybsyi	ofal xusc gihr phw5 4jar jwcc s5sk qo4p		2026-04-02 02:09:47.823115+00	2026-04-02 02:09:47.823115+00	\N
4	AlibertiRoehrig@gmail.com	wrw3zvvox	xvjc acbu 4274 rb5f 7qc2 xhm5 eleo tvyy		2026-04-02 02:09:47.824048+00	2026-04-02 02:09:47.824048+00	\N
5	aliyahclements612136@gmail.com	pKGbttuanhung1408y	em5w asyo nzwt bowe iys5 ns4y q6z6 2b7x		2026-04-02 02:09:47.82718+00	2026-04-02 02:09:47.82718+00	\N
6	ambrosesanchez979588@gmail.com	cdePwtuanhung1407ym	cfp6 jurw j56r ami3 ph2t s7it b3jw hhtm		2026-04-02 02:09:47.828025+00	2026-04-02 02:09:47.828025+00	\N
7	amitygould973246@gmail.com	rJgcFtuanhung1507y	mi67 4tmp cjzm qjf3 xczr juti px3h yk3x		2026-04-02 02:09:47.828655+00	2026-04-02 02:09:47.828655+00	\N
8	anni.kafck@gmail.com	hWcJw3b3t0nsbfz	lk7b 33tn rmjc jy5o qp4t ectn nqz5 of35		2026-04-02 02:09:47.82939+00	2026-04-02 02:09:47.82939+00	\N
9	atlantareynolds304223@gmail.com	qxSLGtuanhung1408y	rczv ohno m4pi 4gs6 b76w l7wq byja k2xy		2026-04-02 02:09:47.830179+00	2026-04-02 02:09:47.830179+00	\N
10	BaadsgaardOguendo@gmail.com	y2jytlpela	qa2h t5io 4ku2 6oyd a4t5 r6df etqd kk56		2026-04-02 02:09:47.830945+00	2026-04-02 02:09:47.830945+00	\N
11	BaahLony252@gmail.com	7tfqjougwy	j5nx wq47 mb4q iy6r m2nd l6cr opo2 oclf		2026-04-02 02:09:47.831648+00	2026-04-02 02:09:47.831648+00	\N
12	BaierlMorandi@gmail.com	hjx7tpqewv	kq5j vtcs wpyt fpl2 y36l eaq2 6guk usao		2026-04-02 02:09:47.833619+00	2026-04-02 02:09:47.833619+00	\N
13	BlancaAngel870@gmail.com	vyrwevoody	2f3y gwp5 ivmh jm6q tz3t 444d 2crx u4tz		2026-04-02 02:09:47.834492+00	2026-04-02 02:09:47.834492+00	\N
14	calliopekerr221460@gmail.com	xxyLztuanhung1607y14m	omwj dvzy kex2 wtkm q3ov q37c zqj7 rk5e		2026-04-02 02:09:47.835095+00	2026-04-02 02:09:47.835095+00	\N
15	carnelianlewis596677@gmail.com	DIyCjtuanhung1307y	a4lo zlwu qrvv q63s sfm4 wu7x pcbx 6z6y		2026-04-02 02:09:47.835536+00	2026-04-02 02:09:47.835536+00	\N
16	carylnkeith954261@gmail.com	rSFNytuanhung1307y	j5l7 qa7i rid6 5hu3 yhws qltl kii3 lbkm		2026-04-02 02:09:47.835975+00	2026-04-02 02:09:47.835975+00	\N
17	catherinecorbyn711259@gmail.com	gAqBOtuanhung1507y	j6jq elje 7uef wujq 3gtc icf6 t5dr 345b		2026-04-02 02:09:47.83754+00	2026-04-02 02:09:47.83754+00	\N
18	CathernSturgis@gmail.com	kqjh2f8qy2m	dg6s kjyr uj64 anmi zboc i4ef afpe uy4v		2026-04-02 02:09:47.839553+00	2026-04-02 02:09:47.839553+00	\N
19	clarawashington756773@gmail.com	Bplwptuanhung1607y	nmw7 bweo g63k neh3 eeyp xidi 5p5w javk		2026-04-02 02:09:47.840554+00	2026-04-02 02:09:47.840554+00	\N
20	CoreasPelotte602@gmail.com	3z2mhdzza	pzkb hmal do4d 4kp4 x6sv inec 7v4u agvd		2026-04-02 02:09:47.841291+00	2026-04-02 02:09:47.841291+00	\N
21	CrosslandHiru@gmail.com	8o9gdilw3no	6epf qom5 3a25 do3f ins3 neae zmdg mixy		2026-04-02 02:09:47.841946+00	2026-04-02 02:09:47.841946+00	\N
22	DonnyKristanto879@gmail.com	59aizgg7r	drwx a7og fkvm 76mq lvd3 iaie 3rqx 7a4x		2026-04-02 02:09:47.84244+00	2026-04-02 02:09:47.84244+00	\N
23	DraibarRajpal735@gmail.com	beadf0q8bz	2n55 whx3 kwah 26vs hnky h5g4 ck24 zavg		2026-04-02 02:09:47.842868+00	2026-04-02 02:09:47.842868+00	\N
24	EinatSadan57@gmail.com	utpfxe9x3	in7q w32f bqn7 mmhx gwzz omfd 7q76 7jis		2026-04-02 02:09:47.843371+00	2026-04-02 02:09:47.843371+00	\N
25	elfledalawrence719286@gmail.com	SiIYituanhung1407ym	4epn vyfy tjiv ri5o 5v5a qcus qc3s fgys		2026-04-02 02:09:47.843926+00	2026-04-02 02:09:47.843926+00	\N
26	ellamoss880852@gmail.com	jeUuDtuanhung1307ym	pz4w k2zl xbu4 7ocw de5z 4n2u h7fi 4pq4		2026-04-02 02:09:47.844669+00	2026-04-02 02:09:47.844669+00	\N
27	EntrupTepper@gmail.com	qrelykhr2za	atrd ciox vabf ikng jshs ia6e lazz 2q4p		2026-04-02 02:09:47.845818+00	2026-04-02 02:09:47.845818+00	\N
28	ericacain641995@gmail.com	vDMEVtuanhung1508y	7tlz bdqw zntz 434m 6ufb bwxl fv7j 6h4f		2026-04-02 02:09:47.84692+00	2026-04-02 02:09:47.84692+00	\N
29	FribleyAkiko@gmail.com	amklw79depi	lkko 3sa3 loo3 mwpt uejh 7e42 rxxa 6vfo		2026-04-02 02:09:47.847678+00	2026-04-02 02:09:47.847678+00	\N
30	GarczynskiIsmail@gmail.com	7pm6pgqhg	xnva n6jq ciut iyta bo7k y55i xmrc aj5z		2026-04-02 02:09:47.849845+00	2026-04-02 02:09:47.849845+00	\N
31	GlissonLeos948@gmail.com	ww1nyoff49e	h5bx 3h4x ttzb izth eoit 4upg th75 n4dd		2026-04-02 02:09:47.850741+00	2026-04-02 02:09:47.850741+00	\N
32	GoltInghram455@gmail.com	aldnpzewlv	cfrf vr2n swoj q33e eebn qh7g uj5n ftxn		2026-04-02 02:09:47.851345+00	2026-04-02 02:09:47.851345+00	\N
33	gwencain624314@gmail.com	wuiqNtuanhung1507y	kyia eh4g hwcs b6jf bt5c m7yh zuwl ibch		2026-04-02 02:09:47.851843+00	2026-04-02 02:09:47.851843+00	\N
34	HelwegDoughtery@gmail.com	vxw646ap3	352s q3br qprk 2wm4 ia2z 7aas 22c5 5434		2026-04-02 02:09:47.852318+00	2026-04-02 02:09:47.852318+00	\N
35	hypatiaeaton437370@gmail.com	BqIuStuanhung1507y	avsw oags z74u cfiq r5tg eeii fmil esge		2026-04-02 02:09:47.852813+00	2026-04-02 02:09:47.852813+00	\N
36	irisgill854652@gmail.com	cLtcItuanhung1407ym	b77l pvej cfuo hmt4 zvr3 dc57 7wvn bgpo		2026-04-02 02:09:47.853191+00	2026-04-02 02:09:47.853191+00	\N
37	jasminecampbell443828@gmail.com	UOjDxtuanhung1607y14m	thbi x2fc gsvy dkwg lisj eu37 w5t2 2cum		2026-04-02 02:09:47.853801+00	2026-04-02 02:09:47.853801+00	\N
38	JokovicSagda@gmail.com	1uiz4snlq07	evwr q4us xadz ji6d zrlh zd52 h77c z67e		2026-04-02 02:09:47.85424+00	2026-04-02 02:09:47.85424+00	\N
39	JuraBensen@gmail.com	yjsjeogym	43k7 uhv4 sns2 yolr xsgd 7n4g iu2r czvw		2026-04-02 02:09:47.854632+00	2026-04-02 02:09:47.854632+00	\N
40	keelincampbell751703@gmail.com	iShVCtuanhung1507y	5ag5 kaqm rvmy 5vsz o2zc adoc p6fs v5bi		2026-04-02 02:09:47.855386+00	2026-04-02 02:09:47.855386+00	\N
41	KraszewskiPastano470@gmail.com	lmcbnqztdxn	gxqh fe5l 4nac idu5 wdnh u3rh q5ub lm7z		2026-04-02 02:09:47.856055+00	2026-04-02 02:09:47.856055+00	\N
42	LacailleNierer@gmail.com	sjcttx06u	5qfn 5556 eedz fvcz khky u4to 424g emzc		2026-04-02 02:09:47.856606+00	2026-04-02 02:09:47.856606+00	\N
43	latifahreed24040@gmail.com	mWOPYtuanhung1607y	uwd7 mckz fvpp adai cc4o 6ayq o73c hmgk		2026-04-02 02:09:47.857236+00	2026-04-02 02:09:47.857236+00	\N
44	leightonwebb322778@gmail.com	eCdzZtuanhung1407y	ni67 wqgm kqtp b7d4 t2uv 3pdk 3qbz f32y		2026-04-02 02:09:47.857734+00	2026-04-02 02:09:47.857734+00	\N
45	lucastawebb652097@gmail.com	kIPHutuanhung1407y	2nxj fqvn zvxc gdsl gik2 7d7j cxfj iawo		2026-04-02 02:09:47.858157+00	2026-04-02 02:09:47.858157+00	\N
46	MarsBechel@gmail.com	942u7fuzw	fsk7 wxwm fer2 wmyl bypq b2ay mbo2 z2ya		2026-04-02 02:09:47.858711+00	2026-04-02 02:09:47.858711+00	\N
47	meieaton583875@gmail.com	wFyDOtuanhung1407ym	vflg ojbr bv4j q5ce spli yvqr s3d2 6yrx		2026-04-02 02:09:47.859143+00	2026-04-02 02:09:47.859143+00	\N
48	meredithcrosby822489@gmail.com	UzXVDtuanhung1507y	slv7 sjnl 3mfl zqi5 rz3m 2zxe 4nbz ba2j		2026-04-02 02:09:47.859583+00	2026-04-02 02:09:47.859583+00	\N
49	miacook890048@gmail.com	lwQwwtuanhung1307y	susx haam x5ev serg g5cp alse c46g e2vn		2026-04-02 02:09:47.860064+00	2026-04-02 02:09:47.860064+00	\N
50	mildredlawrence595979@gmail.com	dMnRJtuanhung1607y14m	3ewo be43 rgw5 fkm4 odah l3zp bqqm qiqr		2026-04-02 02:09:47.860987+00	2026-04-02 02:09:47.860987+00	\N
51	morelacastro774085@gmail.com	fOqjPtuanhung1507y	pdnj x2cg brpv qpqi 62hc 75z4 dgo3 swhh		2026-04-02 02:09:47.861609+00	2026-04-02 02:09:47.861609+00	\N
52	MottsMcduffee@gmail.com	fbbe822qcqr	bmxx zpsf oiav pvkf g27d 45ch ljfe rx5d		2026-04-02 02:09:47.862304+00	2026-04-02 02:09:47.862304+00	\N
53	nealafleming862956@gmail.com	dmLyutuanhung1408y	xbqv c4kw pwk5 ngew v655 ogkj 4exb 2ysw		2026-04-02 02:09:47.863014+00	2026-04-02 02:09:47.863014+00	\N
54	NevueBraverman@gmail.com	qtzlalaxaj5	vbtg dinm j6ja vbxx cyu5 kbli nwwz tzua		2026-04-02 02:09:47.863705+00	2026-04-02 02:09:47.863705+00	\N
55	yeddapace254423@gmail.com	qTdlQtuanhung1407y14m	2hpf 47ej qgzs 4gmw duhq zg2p 4hnn tobo		2026-04-02 02:09:47.864158+00	2026-04-02 02:09:47.864158+00	\N
56	sigridkidd24219@gmail.com	gmNuCtuanhung1307y	4yeg 7g3w s7dk tzlt ty62 qdby 5flz bnja		2026-04-02 02:09:47.86462+00	2026-04-02 02:09:47.86462+00	\N
57	ScarverPriolean@gmail.com	xbrmtdqzaeu	7b7b iz47 lprp dub2 7kdz qtzj brpc brb3		2026-04-02 02:09:47.866166+00	2026-04-02 02:09:47.866166+00	\N
58	SteinworthGudat259@gmail.com	biuq7lrt7	7thk jvz6 gzxg ticv fjsh 5z5b hlpi kkzg		2026-04-02 02:09:47.866947+00	2026-04-02 02:09:47.866947+00	\N
2	abolirowe733317@gmail.com	hWUbituanhung1407y	svqw kwu6 nuqx q3ut urmo otda cw5e z7oq		2026-04-02 02:09:47.821728+00	2026-04-02 04:17:04.189+00	isp.oxylabs.io:8080:proxyvip_VV7Fk:Lungtung1_23
59	tourmalinegomez412944@gmail.com	gAqBOtuanhung1507y	a2nn m7ut mfda f57l nbrh motm l53o hyii		2026-04-02 02:09:47.867343+00	2026-04-02 02:09:47.867343+00	\N
60	tiffanycox644060@gmail.com	NuHoQtuanhung1507y	cxoq 4doi 5w23 ueqx e5sw oc37 p643 273q		2026-04-02 02:09:47.867714+00	2026-04-02 02:09:47.867714+00	\N
61	YifuVh@gmail.com	fsbqu8azozw	d4gh 2pn4 n3ny vkgu t3c3 wqre 2iwn gkb3		2026-04-02 02:09:47.868155+00	2026-04-02 02:09:47.868155+00	\N
62	sewardclay118809@gmail.com	KLfXvtuanhung1407y	d734 oxk5 7p6y ddjn at6m xidy tdgz ohbb		2026-04-02 02:09:47.868588+00	2026-04-02 02:09:47.868588+00	\N
63	radleyperry432102@gmail.com	ehsUytuanhung1507y	idby uirw hhcm yuxm iymd q35i uehn 5jrr		2026-04-02 02:09:47.869026+00	2026-04-02 02:09:47.869026+00	\N
64	sterlingkent631520@gmail.com	CxqZttuanhung1507y	j4rw mkrn 4mor 53ah eyuk q2m6 yd3a raje		2026-04-02 02:09:47.869408+00	2026-04-02 02:09:47.869408+00	\N
65	SloweMisti852@gmail.com	of2xbxkyw	jcmn lzld aqi5 lh22 nodb 7qhh sumj m7ew		2026-04-02 02:09:47.869806+00	2026-04-02 02:09:47.869806+00	\N
66	SeeneySendejo@gmail.com	imp9skipxim	joba 644e nn3b gzgf zj42 4m7z lhsj 6ki7		2026-04-02 02:09:47.870212+00	2026-04-02 02:09:47.870212+00	\N
67	YayiOldenburger@gmail.com	5whyx76qgta	kgrn noqh j2oa vkpi ofer abwl mlbo rt6k		2026-04-02 02:09:47.870598+00	2026-04-02 02:09:47.870598+00	\N
68	VlahovichBuhrman@gmail.com	euleyujn7	kvfm otdu mkiw e35k t26x ae5b hoyv qhtv		2026-04-02 02:09:47.870966+00	2026-04-02 02:09:47.870966+00	\N
69	thaliawest323407@gmail.com	lcPswtuanhung1507y	laqx dmmv a323 de22 bsz7 ncdn tr36 dmzx		2026-04-02 02:09:47.871371+00	2026-04-02 02:09:47.871371+00	\N
70	SchmelzNeblett389@gmail.com	ebonhfwff	lfdg sylv 3dzx ohg2 xk23 6jsh jgwk lnff		2026-04-02 02:09:47.871808+00	2026-04-02 02:09:47.871808+00	\N
71	TfJorge14@gmail.com	iamavqd4o	lyme gn2w e2jk tvro 2dr3 aizu 247m jpfk		2026-04-02 02:09:47.872869+00	2026-04-02 02:09:47.872869+00	\N
72	RadejWildhaber@gmail.com	zn6hau07gg	nft7 ova3 5p3p bjd6 k6jz p7uu e72j ikr5		2026-04-02 02:09:47.873985+00	2026-04-02 02:09:47.873985+00	\N
73	VenhorstAndrades@gmail.com	rvrhmcroc	olzz ju73 rx22 vted vukh tpvx 6ahg niye		2026-04-02 02:09:47.874771+00	2026-04-02 02:09:47.874771+00	\N
74	theklaherrera784541@gmail.com	TiQRxtuanhung1607y14m	t3tl n6oq ksnf rhil xqze ysz6 zgxo u46c		2026-04-02 02:09:47.875312+00	2026-04-02 02:09:47.875312+00	\N
75	rachelhoover194825@gmail.com	TiQRxtuanhung1507y	xibj if2r enwc zlfh zffa hr33 mojg pqd3		2026-04-02 02:09:47.875806+00	2026-04-02 02:09:47.875806+00	\N
76	PaxmanSide@gmail.com	sm6qub82aq	xzgo qt2x 2oqd df53 7kyl rlbm 7kr2 s3tt		2026-04-02 02:09:47.876362+00	2026-04-02 02:09:47.876362+00	\N
77	RabiaMartinez690@gmail.com	xeaxtavp7	ysxl x7yg llom 7wa5 5wbf xcg5 rrw3 7npm		2026-04-02 02:09:47.876854+00	2026-04-02 02:09:47.876854+00	\N
78	rubyprince312039@gmail.com	XLYcgtuanhung1407y14m	yxtq 2oal qhud 4udo c7p5 2xq7 nm4j 2szq		2026-04-02 02:09:47.877431+00	2026-04-02 02:09:47.877431+00	\N
79	SebaPantera357@gmail.com	flvjfpqph8	zrx3 v3st ld3y lgbo xvlv hjyd 2mdm a735		2026-04-02 02:09:47.878049+00	2026-04-02 02:09:47.878049+00	\N
1	AbdullaiGuerrier51@gmail.com	4ippvdcwa5	6chx lsnv 7evq rds3 3it2 phx5 p4t5 awdc		2026-04-02 02:09:47.815875+00	2026-04-02 04:06:11.294+00	isp.oxylabs.io:8099:proxyvip_VV7Fk:Lungtung1_23
\.


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: ggchecks
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 1, false);


--
-- Name: check_results_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ggchecks
--

SELECT pg_catalog.setval('public.check_results_id_seq', 86, true);


--
-- Name: service_accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: ggchecks
--

SELECT pg_catalog.setval('public.service_accounts_id_seq', 79, true);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: ggchecks
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: check_results check_results_pkey; Type: CONSTRAINT; Schema: public; Owner: ggchecks
--

ALTER TABLE ONLY public.check_results
    ADD CONSTRAINT check_results_pkey PRIMARY KEY (id);


--
-- Name: service_accounts service_accounts_email_unique; Type: CONSTRAINT; Schema: public; Owner: ggchecks
--

ALTER TABLE ONLY public.service_accounts
    ADD CONSTRAINT service_accounts_email_unique UNIQUE (email);


--
-- Name: service_accounts service_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: ggchecks
--

ALTER TABLE ONLY public.service_accounts
    ADD CONSTRAINT service_accounts_pkey PRIMARY KEY (id);


--
-- Name: check_results_created_at; Type: INDEX; Schema: public; Owner: ggchecks
--

CREATE INDEX check_results_created_at ON public.check_results USING btree (created_at);


--
-- Name: check_results_sa_id_idx; Type: INDEX; Schema: public; Owner: ggchecks
--

CREATE INDEX check_results_sa_id_idx ON public.check_results USING btree (service_account_id);


--
-- Name: check_results check_results_service_account_id_service_accounts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: ggchecks
--

ALTER TABLE ONLY public.check_results
    ADD CONSTRAINT check_results_service_account_id_service_accounts_id_fk FOREIGN KEY (service_account_id) REFERENCES public.service_accounts(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict MpgmLIDbLKzzxkSZpDHHEW46ts6h4137zoFtUz4bgbQmMNIdULxZHxh3JeKp0l4


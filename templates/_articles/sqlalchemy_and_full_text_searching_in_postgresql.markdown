---

title: "SQLAlchemy and full text searching in postgresql"

date: "2013-11-29 11:28:48 +0530"

---

### Introduction
Postgresql has support for [full text search](http://www.postgresql.org/docs/current/static/textsearch.html). The basic idea is to create a column of type `tsvector` and then you can run full text queries (represented as `tsquery` strings) using the `@@` operator. This is different from the `LIKE` queries using the `%string%` since this is language aware and can provide things like ranking etc. As an example,

    SELECT 'I am satisfied with postgresql' LIKE '%satisfied%' as found;

will return

    found 
    -------
    t

However, if we use `"%satisfy%"` as the query string, it will fail since it's text based.

    SELECT 'I am satisfied with postgresql' LIKE '%satisfy%' as found;
     found 
    -------
     f

If we use a full text query, we will get it right though.

    SELECT to_tsvector('I am satisfied with postgresql') @@ to_tsquery('satisfy') as found;
     found 
    -------
     t

[SQLAlchemy](http://sqlalchemy.org) is the Python database toolkit of choice. It supports most of the popular databases out there and has dialect specific features for mysql, postgresql etc. The tsvector type is not natively supported. It's not very hard to add support for this but I couldn't find a single reference that helps me do it. After some trial and error, I managed to get this to work (atleast for my purposes) so I'm going to write out what I did. I'll put links to the articles, posts and other materials on the net which helped me get this to work.

Feedback is welcome as are suggestions on how to get this fully feature complete. If sufficiently done, I'll contribute this as a patch back to SQLAlchemy.

### The table we want

First, I create a table like so

    CREATE TABLE example (
        name VARCHAR(10),
        details TEXT
    );

And then, I insert [1000 rows](/stuff/items.csv) into this using

    COPY example FROM '/home/noufal/projects/scratch/sa/items.csv' (FORMAT csv);

Now, I have a database to play with. I can do full text searches like so

    SELECT * FROM example where to_tsvector('english', details) @@ to_tsquery('life') limit 3;
      name   |                                                                     details                                                                     
    ---------+-------------------------------------------------------------------------------------------------------------------------------------------------
     item-20 |  Life is a grand adventure -- or it is nothing.                 -- Helen Keller 
     item-46 |  Life is a gamble at terrible odds; if it was a bet you wouldn't take it.               -- Tom Stoppard; Rosencrantz and Guildenstern are Dead 
     item-63 |  Life is like a 10 speed bicycle.  Most of us have gears we never use.          -- C. Schultz

    
The `'english'` in the `to_tsvector` is optional. If I skip it, it'll use the default.

Full text items that can be searched are referred to as `documents` in postgresql. Now, I create an extra column that holds the document to be searched like so.

    ALTER TABLE example ADD COLUMN details_tsvector TSVECTOR;

Then, I run an update on the table that creates the tsvector documents and puts them into this column like so

    UPDATE example SET details_tsvector = to_tsvector(details);

Now, if I do a full query, it'll return the actual tsvector documents.

    SELECT name, details_tsvector FROM example limit 3;
      name  |                    details_tsvector                     
    --------+---------------------------------------------------------
     item-1 | 'bathroom':7 'left':2 'wallet':4
     item-2 | 'bit':7 'could':11 'difficult':3 'effort':9 'imposs':13
     item-3 | 'avoid':3 'hedg':4 'least':6 'think':11

I can search the table like so

    SELECT name, details FROM example WHERE details_tsvector @@ to_tsquery('life') limit 3;
      name   |                                                                     details                                                                     
    ---------+-------------------------------------------------------------------------------------------------------------------------------------------------
     item-20 |  Life is a grand adventure -- or it is nothing.                 -- Helen Keller 
     item-46 |  Life is a gamble at terrible odds; if it was a bet you wouldn't take it.               -- Tom Stoppard; Rosencrantz and Guildenstern are Dead 
     item-63 |  Life is like a 10 speed bicycle.  Most of us have gears we never use.          -- C. Schultz

This, of course, is faster than the other approach since the documents have already been generated. However, running an EXPLAIN shows us how the query is working.

    EXPLAIN SELECT name, details FROM example WHERE details_tsvector @@ to_tsquery('life');
                            QUERY PLAN                        
    ----------------------------------------------------------
     Seq Scan on example  (cost=0.00..53.30 rows=26 width=92)
       Filter: (details_tsvector @@ to_tsquery('life'::text))

One advantage of tsvector columns (over `LIKE` queries) is that they can be indexed. If I add an index like so,

    CREATE INDEX details_idx ON example USING gin(details_tsvector);

The output of the EXPLAIN command changes.

    EXPLAIN SELECT name, details FROM example WHERE details_tsvector @@ to_tsquery('life');
                                     QUERY PLAN                                 
    ----------------------------------------------------------------------------
     Bitmap Heap Scan on example  (cost=12.20..50.17 rows=26 width=92)
       Recheck Cond: (details_tsvector @@ to_tsquery('life'::text))
       ->  Bitmap Index Scan on details_idx  (cost=0.00..12.20 rows=26 width=0)
             Index Cond: (details_tsvector @@ to_tsquery('life'::text))

which will be quicker.
    
One problem with this is that the `details_tsvector` column is not automatically updated when new rows are inserted. I can fix this by creating a trigger that will automatically compute and add the values when a row is UPDATEd or INSERTed into. 


    CREATE TRIGGER details_tsvector_update BEFORE INSERT OR UPDATE
    ON example
    FOR EACH ROW EXECUTE PROCEDURE
    tsvector_update_trigger('details_tsvector', 'pg_catalog.english', 'details');
    
Now, if I run an `INSERT` statement, the `details_tsvector` will get updated.

The table definition looks like this


                    Table "public.example"
          Column      |         Type          | Modifiers 
    ------------------+-----------------------+-----------
     name             | character varying(10) | 
     details          | text                  | 
     details_tsvector | tsvector              | 
    Indexes:
        "details_idx" gin (details_tsvector)
    Triggers:
        details_tsvector_update BEFORE INSERT OR UPDATE ON example FOR EACH ROW EXECUTE PROCEDURE tsvector_update_trigger('details_tsvector', 'pg_catalog.english', 'details')

This is what I need for my application but I need to do it using SQLAlchemy inside my application rather than in SQL. The rest of the article will cover this.

### Scaffold

To play with the whole thing, I have a tiny program that takes command line arguments to run various database operations. It's what I use to manually test the code. Here it is. There are a few imports which are not necessary at this point but which we'll use later. 


    import subprocess
    
    from sqlalchemy.ext.declarative import declarative_base
    from sqlalchemy import Column, Integer, String, VARCHAR, create_engine, func, MetaData, Table, Index, event, DDL
    from sqlalchemy.orm import sessionmaker
    
    engine = create_engine('postgresql://noufal:abcdef@localhost/test', echo = True)
    Base = declarative_base()
    Session = sessionmaker(bind = engine)
    session = Session()
    
    class Example(Base):
        __tablename__ = 'example'
    
        name = Column(VARCHAR(10), primary_key = True)
        details = Column(String)
    
    
    def create_tables():
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
    
    
    if __name__ == '__main__':
        import sys
        for i in sys.argv[1:]:
            print "\n","=================",i,"==================="
            dict(create = create_tables)[i]()


This should be familiar to you if you've used SQLAlchemy before. It simply defines a table in the new declarative format. One difference between this and our original setup is that the `name` field is now a primary key and therefore has a uniqueness constraints and an auto increment. The file is called `sample.py` If we run

    python sample.py create

We'll get the `example` table. The schema is very plain now and doesn't have the `tsvector` type.

### Creating the type

For this, we'll need to derive from the `sqlalchemy.types.UserDefinedType`. This is mostly based on the [postgis example in the SQLAlchemy source tree](https://github.com/zzzeek/sqlalchemy/blob/master/examples/postgis/postgis.py). We simply create a new type derived from UserDefinedType and then give it a name. We have just one method inside it which is `get_col_spec`. 

    class TsVector(UserDefinedType):
        "Holds a TsVector column"
    
        name = "TSVECTOR"
    
        def get_col_spec(self):
            return self.name


The `get_col_spec` function is used by the expression compiler to decide what the name of the type will be in the DDL. Since it's called `TSVECTOR`, that's what we should return here. The core types, as far as I know have their types coded directly into the compiler (e.g. For the SQLAlchemy provided `Boolean` type translates to the `BOOLEAN` type in the DDL). For Use defined types, the compiler will explicitly call the `get_col_spec` function to get the type name. This is the bare minimum to create the table.

### Creating the tables.

First, we add the above snippet to our code and then we add a column of type `TsVector` to our `Example` class and run the script again. This time, we'll get the table with the `tsvector` column. Our code looks like this now.

    import subprocess
    
    from sqlalchemy.ext.declarative import declarative_base
    from sqlalchemy import Column, Integer, String, VARCHAR, create_engine, func, MetaData, Table, Index, event, DDL
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.types import UserDefinedType
    
    engine = create_engine('postgresql://noufal:abcdef@localhost/test', echo = True)
    Base = declarative_base()
    Session = sessionmaker(bind = engine)
    session = Session()
    
    class TsVector(UserDefinedType):
        "Holds a TsVector column"
    
        name = "TSVECTOR"
    
        def get_col_spec(self):
            return self.name
    
    class Example(Base):
        __tablename__ = 'example'
    
        name = Column(VARCHAR(10), primary_key = True)
        details = Column(String)
        details_tsvector = Column(TsVector)
    
    
    def create_tables():
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
    
    
    if __name__ == '__main__':
        import sys
        for i in sys.argv[1:]:
            print "\n","=================",i,"==================="
            dict(create = create_tables)[i]()

### Add a few helper functions

I'm adding a new function called `insert_data` like so

    def insert_data():
        for i in range(1, 20):
            u = Example(name = "name-{}".format(i),
                        details = subprocess.Popen("/usr/games/fortune", stdout = subprocess.PIPE).stdout.read())
            session.add(u)
            print ".",
        session.commit()

And another called `dump_data` like so

    def dump_data():
        for i in session.query(Example):
            print "name: ", i.name
            print "details: \n------------\n",i.details
            print "details_tsvector: \n--------\n",i.details_tsvector
            print "=================================================="

and making them available from the command line using


     dict(create = create_tables,
          insert = insert_data,
          dump = dump_data)[i]()

Now, I can run

     python sample.py create insert

and I get a database with 20 rows in it. Running

     python sample.py dump

will show me what's in there. The `details_tsvector` row is always empty. 


### Adding an index for this column

As it stands, the `details_tsvector` row doesn't have it's own index. We can alter the table definition to add an index by adding

    __table_args__ = (Index('details_tsvector_idx', 'details_tsvector', postgresql_using = 'gin'),)

to the `Example` table. 

`__table_args__` allows you to add extra stuff like constraints and things to the table. It expects this to be a tuple or a dictionary so we wrap it in the `(` `)` (along with the notoriously ugly `,` at the end for single valued tuples). The `Index('details_tsvector_idx', 'details_tsvector', postgresql_using = 'gin')` line creates a gin index called `details_tsvector_idx` on the `details_tsvector` column. The [postgresql dialect module](http://docs.sqlalchemy.org/en/rel_0_9/dialects/postgresql.html#postgresql-indexes) interprets the `postgresl_using` parameter to create a [gin index](http://www.postgresql.org/docs/8.3/static/indexes-types.html). Different indices have different tradeoffs and you should select one that works for you.

[Reference](http://stackoverflow.com/questions/6626810/multiple-columns-index-when-using-the-declarative-orm-extension-of-sqlalchemy).


### Automatically updating the column using a trigger.

I need to automatically update this column when a new row is inserted into the table. We can accomplish this inside postgresql itself using a trigger. This is done like so.


    trigger_snippet = DDL("""
    CREATE TRIGGER details_tsvector_update BEFORE INSERT OR UPDATE
    ON example
    FOR EACH ROW EXECUTE PROCEDURE
    tsvector_update_trigger(details_tsvector,'pg_catalog.english', 'details')
    """)
    
    event.listen(Example.__table__, 'after_create', trigger_snippet.execute_if(dialect = 'postgresql'))
    
This automatically updates the rows that were modified by an insert or update operation. The `tsvector_update_trigger` is a function provided by postgresql that takes 3 arguments - the name of the column that needs to be updated, the configuration to use for the conversion and then a list of columns that will be included in the document. It will take care of `NULL` columns.

I think it's also possible to do this using [the sqlalchemy event system](http://docs.sqlalchemy.org/en/rel_0_8/orm/events.html) but I'm not sufficiently familiar with it.

Adding elements now will automatically populate the index column.

[Reference](http://stackoverflow.com/questions/8929738/sqlalchemy-declarative-defining-triggers-and-indexes-postgres-9)

The code now, looks like this.

    import subprocess
    
    from sqlalchemy.ext.declarative import declarative_base
    from sqlalchemy import Column, Integer, String, VARCHAR, create_engine, func, MetaData, Table, Index, event, DDL
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.types import UserDefinedType
    
    engine = create_engine('postgresql://noufal:abcdef@localhost/test', echo = True)
    Base = declarative_base()
    Session = sessionmaker(bind = engine)
    session = Session()
    
    class TsVector(UserDefinedType):
        "Holds a TsVector column"
    
        name = "TSVECTOR"
    
        def get_col_spec(self):
            return self.name
    
    class Example(Base):
        __tablename__ = 'example'
    
        name = Column(VARCHAR(10), primary_key = True)
        details = Column(String)
        details_tsvector = Column(TsVector)
    
        __table_args__ = (Index('details_tsvector_idx', 'details_tsvector', postgresql_using = 'gin'),)
    
    trigger_snippet = DDL("""
    CREATE TRIGGER details_tsvector_update BEFORE INSERT OR UPDATE
    ON example
    FOR EACH ROW EXECUTE PROCEDURE
    tsvector_update_trigger(details_tsvector,'pg_catalog.english', 'details')
    """)
    
    event.listen(Example.__table__, 'after_create', trigger_snippet.execute_if(dialect = 'postgresql'))
        
    
    def create_tables():
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
    
    def insert_data():
        for i in range(1, 20):
            u = Example(name = "name-{}".format(i),
                        details = subprocess.Popen("/usr/games/fortune", stdout = subprocess.PIPE).stdout.read())
            session.add(u)
            print ".",
        session.commit()
    
    
    def dump_data():
        for i in session.query(Example):
            print "name: ", i.name
            print "details: \n------------\n",i.details
            print "details_tsvector: \n--------\n",i.details_tsvector
            print "=================================================="
    
    
    if __name__ == '__main__':
        import sys
        for i in sys.argv[1:]:
            print "\n","=================",i,"==================="
            dict(create = create_tables,
                 insert = insert_data,
                 dump = dump_data)[i]()

Now, you can run `python sample.py create` and get the whole thing done. The defined table looks like this.

                   Table "public.example"
          Column      |         Type          | Modifiers 
    ------------------+-----------------------+-----------
     name             | character varying(10) | not null
     details          | character varying     | 
     details_tsvector | tsvector              | 
    Indexes:
        "example_pkey" PRIMARY KEY, btree (name)
        "details_tsvector_idx" gin (details_tsvector)
    Triggers:
        details_tsvector_update BEFORE INSERT OR UPDATE ON example FOR EACH ROW EXECUTE PROCEDURE tsvector_update_trigger('details_tsvector', 'pg_catalog.english', 'details')

So, we have what we need. The next thing is querying.


### Querying

In SQL, it is possible now to run queries like so.

    select * from example where details_tsvector @@ to_tsquery('life') limit 1;

which finds rows with the [lexeme](https://en.wikipedia.org/wiki/Lexeme) `life` in our full text search column.

I'd like to do this in Python using my custom type. Something like this.

    session.query(Example).filter(Example.details_tsvector == "life")

And this should translate into

    SELECT * FROM example WHERE details_tsvector @@ to_tsquery('life');

This might not be optimal since the `==` is distinct from the `@@` operator but it'll illustrate the comparator factory and allow us to use a native Python comparison operator in our expressions.

We can accomplish this by adding a


    class comparator_factory(UserDefinedType.Comparator):
        """Defines custom types for tsvectors. 
        
        Specifically, the ability to search for ts_query strings using
        the @@ operator.

        On the Python side, this is implemented simply as a `==` operation.

        So, you can do 
          Table.tsvector_column == "string" 
        to get the same effect as
          tsvector_column @@ to_tsquery('string')
        in SQL

        """
        
        def __eq__(self, other):
            return self.op('@@')(func.to_tsquery(other))

to our `TsVector` class. This basically defines a way for the `__eq__` operator to be converted into the `@@` operator in SQL world.

We also add a `query_data` function to our harness so that we can try to run a query. It looks like this

    def query_data():
        vals = session.query(Example.name, Example.details).filter(Example.details_tsvector == "life")
        for i in vals:
            print "name: ", i.name
            print "details: ", i.details
            print "=================================================="

And update the commands dictionary with a `query` key so that I can run `python sample.py query`. The generated query looks like this

    SELECT example.name AS example_name, example.details AS example_details 
    FROM example 
    WHERE example.details_tsvector @@ to_tsquery('life')

which is exactly what I want.


### Full code

The entire program looks like this now

    #!/usr/bin/env python
    
    import subprocess
    
    from sqlalchemy.ext.declarative import declarative_base
    from sqlalchemy import Column, Integer, String, VARCHAR, create_engine, func, MetaData, Table, Index, event, DDL
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.types import UserDefinedType
    
    engine = create_engine('postgresql://noufal:abcdef@localhost/test', echo = True)
    Base = declarative_base()
    Session = sessionmaker(bind = engine)
    session = Session()
    
    class TsVector(UserDefinedType):
        "Holds a TsVector column"
    
        name = "TSVECTOR"
    
        def get_col_spec(self):
            return self.name
    
    
        class comparator_factory(UserDefinedType.Comparator):
            """Defines custom types for tsvectors.
    
            Specifically, the ability to search for ts_query strings using
            the @@ operator.
    
            On the Python side, this is implemented simply as a `==` operation.
    
            So, you can do
              Table.tsvector_column == "string"
            to get the same effect as
              tsvector_column @@ to_tsquery('string')
            in SQL
    
            """
    
            def __eq__(self, other):
                return self.op('@@')(func.to_tsquery(other))
    
    
    class Example(Base):
        __tablename__ = 'example'
    
        name = Column(VARCHAR(10), primary_key = True)
        details = Column(String)
        details_tsvector = Column(TsVector)
    
        __table_args__ = (Index('details_tsvector_idx', 'details_tsvector', postgresql_using = 'gin'),)
    
    trigger_snippet = DDL("""
    CREATE TRIGGER details_tsvector_update BEFORE INSERT OR UPDATE
    ON example
    FOR EACH ROW EXECUTE PROCEDURE
    tsvector_update_trigger(details_tsvector,'pg_catalog.english', 'details')
    """)
    
    event.listen(Example.__table__, 'after_create', trigger_snippet.execute_if(dialect = 'postgresql'))
    
    
    def create_tables():
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
    
    def insert_data():
        for i in range(1, 20):
            u = Example(name = "name-{}".format(i),
                        details = subprocess.Popen("/usr/games/fortune", stdout = subprocess.PIPE).stdout.read())
            session.add(u)
            print ".",
        session.commit()
    
    
    def dump_data():
        for i in session.query(Example):
            print "name: ", i.name
            print "details: \n------------\n",i.details
            print "details_tsvector: \n--------\n",i.details_tsvector
            print "=================================================="
    
    
    def query_data():
        vals = session.query(Example.name, Example.details).filter(Example.details_tsvector == "divide")
        for i in vals:
            print "name: ", i.name
            print "details: ", i.details
            print "=================================================="
    
    
    if __name__ == '__main__':
        import sys
        for i in sys.argv[1:]:
            print "\n","=================",i,"==================="
            dict(create = create_tables,
                 insert = insert_data,
                 dump = dump_data,
                 query = query_data)[i]()


### Things to implement

Table reflection doesn't work (I don't need it now). I haven't put this into production so I don't know what problems I'll face then.

Feedback is welcome.

### Update (10 Dec 2013)

This was accepted as a [patch into SQLAlchemy](https://github.com/zzzeek/sqlalchemy/commit/d5a86d8f86c0eef8968c8915be19b94ad4682151) so you don't need to do this anymore. The `==` overloading was not used. Instead, the Python `.match` operator implements the `@@` operator on the sql side. I'll leave this article up here though as a tutorial on adding custom types to SQLAlchemy.

